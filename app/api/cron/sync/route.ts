import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/integrations/service';
import { hasDb } from '@/lib/prisma';

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
  const results = await syncAll();

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
    results,
  });
}
