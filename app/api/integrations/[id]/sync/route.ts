import { after } from 'next/server';
import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { driveSync } from '@/lib/integrations/driver';
import { syncStatus } from '@/lib/integrations/service';
import { getProvider } from '@/lib/integrations/registry';
import { IntegrationError } from '@/lib/integrations/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Starts a sync and answers as soon as it has started, not when it has finished.
 *
 * It used to answer with one slice of the pull, and the browser called back until the
 * slice said `done`. That made the tab the engine: switching away throttled the loop and
 * closing it abandoned the backfill part way through, leaving a cursor mid-CRM and a card
 * that read "Connected". Now the slices run in `after()` — and chain into fresh
 * invocations when they outlast this one — so the sync finishes whatever the tab does.
 *
 * The page follows along by polling /api/integrations/sync-status, which reads the same
 * state a reload would, so a sync started in a tab that has since been closed still shows
 * as running to whoever opens the page next.
 */
export const maxDuration = 300;

export const POST = route<unknown, Ctx>('integrations:manage', async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const provider = getProvider(id);
  if (!provider) throw new HttpError(404, `Unknown integration: ${id}`);

  // A cheap pre-check so a double click gets the plain answer instead of two drivers
  // racing for the lock. `claimSync` inside the sync itself is still the real guard —
  // this only saves the second click from being answered "started" when it was not.
  const status = (await syncStatus()).find((s) => s.provider === id);
  if (status?.busy) {
    throw new HttpError(
      409,
      `${provider.name} is already syncing. It will carry on from where it stopped — no need to start another.`,
    );
  }

  try {
    // Named on the run row. Null there means the cron, and "who started this" is the
    // first question asked of a run that overlapped another one.
    after(() => driveSync(id, { days: 30, actorEmail: user.email }));
    return { started: true };
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
