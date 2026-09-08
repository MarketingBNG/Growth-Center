import { sync } from './service.ts';
import { IntegrationError } from './types.ts';
import { TAGS, invalidate } from '../cache.ts';

/**
 * Drives a sync to completion on the server.
 *
 * A provider with tens of thousands of records cannot be pulled inside one request, so
 * `sync()` does a bounded slice and reports `done: false` with its place saved. Something
 * has to call it back until it says done.
 *
 * That used to be the browser: the Integrations card looped on the endpoint until it got
 * `done`. It worked only while the tab stayed open and in the foreground — switch tab and
 * the background timers and refreshes throttle, close it and the loop stops mid-backfill
 * with a cursor half way through the CRM and a card that reads "Connected". So the loop
 * moved here, where nothing the browser does can interrupt it, and the page went back to
 * being a reader of state rather than the engine.
 */

/**
 * The wall-clock a single invocation may spend driving, from when it started.
 *
 * Vercel kills a function at its `maxDuration` (300s) regardless of what it is doing, so
 * a driver has to stop before that and hand the rest to a fresh invocation. `sync()`'s
 * own slice budget is 230s, so one full slice plus the chaining request fits inside this.
 */
const DRIVE_WINDOW_MS = 255_000;

/**
 * The most one slice may be given, whatever is left of the window.
 *
 * `sync()`'s own default, repeated here because the driver hands it a budget explicitly:
 * handing it the whole window would let a slice run right up to the platform's ceiling
 * and be killed there, holding the sync lock, which is the failure the lease exists to
 * mop up after rather than to invite.
 */
const SLICE_BUDGET_MS = 230_000;

/** Below this there is not enough of the window left to fetch a page and write it. */
const MIN_SLICE_MS = 20_000;

/** Bounded so a provider that never reports done cannot chain invocations for ever. */
export const MAX_CHAIN_HOPS = 40;

export type DriveResult =
  | { outcome: 'done'; rows: number; detail: string }
  | { outcome: 'chained' }
  | { outcome: 'busy' }
  | { outcome: 'exhausted' }
  | { outcome: 'failed'; message: string };

/**
 * Runs slices back to back until the provider is done, this invocation's window runs out,
 * or the sync fails.
 *
 * Never throws. It runs inside `after()`, where the response has already been sent and
 * there is no caller left to tell — a failed sync records itself on the integration row
 * and the run row, which is where the page reads it from.
 */
export async function driveSync(
  id: string,
  opts: { days?: number; actorEmail?: string | null; hop?: number } = {},
): Promise<DriveResult> {
  const { days = 30, actorEmail = null, hop = 0 } = opts;
  const until = Date.now() + DRIVE_WINDOW_MS;

  while (Date.now() + MIN_SLICE_MS < until) {
    let slice: Awaited<ReturnType<typeof sync>>;
    try {
      slice = await sync(id, days, actorEmail, Math.min(SLICE_BUDGET_MS, until - Date.now()));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sync failed.';
      // Another driver holds the lock — the cron and a hand-started sync overlapping is
      // not a failure, and the run that holds it is the one making progress.
      if (e instanceof IntegrationError && message.includes('already syncing')) {
        return { outcome: 'busy' };
      }
      // `sync()` has already written the error to the integration row and closed the run,
      // so there is nothing to record here beyond the server log.
      console.error(`[integrations] sync of ${id} failed:`, message);
      await invalidateAfterSlice();
      return { outcome: 'failed', message };
    }

    // Each slice writes what it fetched, so the tables fill as this runs — but the
    // dashboard reads them through a 300-second cache, which would go on serving the
    // figures from before the import for five minutes after it landed.
    await invalidateAfterSlice();

    if (slice.done) return { outcome: 'done', rows: slice.rows, detail: slice.detail };
  }

  // Out of window with the backfill unfinished. Hand it to a fresh invocation.
  if (hop + 1 >= MAX_CHAIN_HOPS) {
    console.warn(
      `[integrations] sync of ${id} still unfinished after ${MAX_CHAIN_HOPS} hops; leaving it to the nightly cron.`,
    );
    return { outcome: 'exhausted' };
  }
  return (await chain(id, days, actorEmail, hop + 1)) ? { outcome: 'chained' } : { outcome: 'exhausted' };
}

async function invalidateAfterSlice() {
  try {
    await invalidate(TAGS.integrations, TAGS.metrics, TAGS.seo, TAGS.social);
  } catch (e) {
    // Cache invalidation failing must not stop the sync it was reporting on.
    console.warn('[integrations] could not invalidate caches mid-sync:', e);
  }
}

/**
 * Asks the platform for another 300 seconds by calling the continuation endpoint.
 *
 * Not awaited to completion — that would keep this invocation alive for the whole of the
 * next one and defeat the point. The request is fired and only its acceptance is waited
 * for, so the work continues in an invocation with a fresh clock.
 *
 * Authenticated with CRON_SECRET rather than the caller's session: there is no session
 * here, and the continuation is the same work the nightly cron does.
 */
async function chain(
  id: string,
  days: number,
  actorEmail: string | null,
  hop: number,
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!secret || !base) {
    // Without both, a backfill still finishes — the nightly cron resumes from the cursor.
    // Said out loud because a local run has neither and would otherwise look stuck.
    console.warn(
      `[integrations] cannot continue the sync of ${id} in a new invocation: ${!secret ? 'CRON_SECRET' : 'NEXTAUTH_URL'} is not set. It will resume on the nightly cron.`,
    );
    return false;
  }
  try {
    const res = await fetch(`${base}/api/cron/sync-provider`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: id, days, actorEmail, hop }),
    });
    if (!res.ok) {
      console.error(`[integrations] continuation of ${id} was refused: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[integrations] could not start the continuation of ${id}:`, e);
    return false;
  }
}
