import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/integrations/service';
import { scanDuplicates } from '@/lib/duplicate-queue';
import { refreshRatesIfStale } from '@/lib/settings';
import { hasDb } from '@/lib/prisma';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * Nightly refresh of every connected integration. Scheduled in vercel.json.
 *
 * Not wrapped in route(): there is no session here, the caller is Vercel's scheduler.
 * It authenticates with CRON_SECRET instead, which Vercel sends as a bearer token.
 *
 * Refuses to run unauthenticated even when CRON_SECRET is unset. The alternative —
 * running openly when the variable is missing — turns one forgotten env var into a
 * public endpoint that hammers four third-party APIs on demand.
 */
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: 'No database configured' }, { status: 503 });
  }

  const started = Date.now();

  // Before the syncs, not after: they can run to a deadline and stop, and the rates are
  // what every money figure on every page is converted with.
  const currency = await refreshRatesIfStale();

  const results = await syncAll();

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
    rates: { fetchedAt: currency.fetchedAt, source: currency.source },
    results,
  });
}
