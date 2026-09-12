import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/integrations/service';
import { scanDuplicates } from '@/lib/duplicate-queue';
import { autofillContent } from '@/lib/content-autofill';
import { refreshRatesIfStale } from '@/lib/settings';
import { cronGuard } from '@/lib/cron-auth';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * Nightly refresh of every connected integration. Scheduled in vercel.json.
 *
 * Not wrapped in route(): there is no session here, the caller is Vercel's scheduler.
 * Authenticated with cronGuard instead, which checks CRON_SECRET as a bearer token and
 * refuses to run even unauthenticated when it is unset — the alternative would turn one
 * forgotten env var into a public endpoint that hammers four third-party APIs on demand.
 */
export const maxDuration = 300;

/**
 * How much of that ceiling the syncs may spend.
 *
 * The rest of this route runs after them — the duplicate scan, the content autofill, the
 * cache invalidation and the response — and all of it is inside the same 300 seconds.
 * Handing `syncAll` an instant to stop at, rather than letting it run until the platform
 * intervenes, is what keeps a slow provider from being killed holding the sync lock.
 */
const SYNC_SHARE_MS = 210_000;

export async function GET(req: Request) {
  const refusal = cronGuard(req);
  if (refusal) return refusal;

  const started = Date.now();

  // Before the syncs, not after: they can run to a deadline and stop, and the rates are
  // what every money figure on every page is converted with.
  const currency = await refreshRatesIfStale();

  // Measured from the top of the request, not from here: the currency refresh above spends
  // the same 300 seconds, so the syncs get what is left of the share rather than all of it.
  const results = await syncAll(30, started + SYNC_SHARE_MS);

  // After the syncs, deliberately. A scan run first would look at yesterday's records and
  // miss every duplicate the night's import just created — which is the commonest kind
  // there is, the same person filling the form twice in a week.
  //
  // Failure here is logged, never thrown: a scanner that could not run must not turn a
  // successful night of syncing into a failed cron. G5.3 asks for candidates, and none
  // tonight is a smaller problem than no data.
  let duplicates: Awaited<ReturnType<typeof scanDuplicates>> | { error: string };
  try {
    duplicates = await scanDuplicates();
  } catch (e) {
    duplicates = { error: (e as Error).message };
    console.error('[cron/sync] duplicate scan failed:', e);
  }

  // §15.4. After the syncs for the same reason the duplicate scan is: Search Console
  // pages and social posts imported tonight are exactly the ones the board is missing.
  //
  // Failure is logged and never thrown. A board that did not fill is a smaller problem
  // than a night of syncing reported as failed.
  let content: Awaited<ReturnType<typeof autofillContent>> | { error: string };
  try {
    content = await autofillContent();
  } catch (e) {
    content = { error: (e as Error).message };
    console.error('[cron/sync] content autofill failed:', e);
  }
  // A sync rewrites metrics, SEO rows and social rows, and can move an integration off
  // demo data. Without this the dashboard would show yesterday's numbers until the TTL.
  await invalidate(TAGS.integrations, TAGS.metrics, TAGS.seo, TAGS.social, TAGS.settings);

  // Logged as well as returned: the response goes to the scheduler, which nobody reads
  // unless something breaks. The log is where a failure is actually noticed.
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) {
    console.error('[cron/sync] failures:', JSON.stringify(failed));
  }

  return NextResponse.json({
    ok: failed.length === 0,
    ms: Date.now() - started,
    synced: results.filter((r) => r.status === 'synced').length,
    duplicates,
    content,
    rates: { fetchedAt: currency.fetchedAt, source: currency.source },
    results,
  });
}
