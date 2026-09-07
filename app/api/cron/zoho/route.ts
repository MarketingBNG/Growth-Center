import { NextResponse } from 'next/server';
import { sync } from '@/lib/integrations/service';
import { hasDb } from '@/lib/prisma';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * Nightly Zoho CRM import. Scheduled in vercel.json.
 *
 * Separate from /api/cron/sync because the CRM cannot share it. A full pass over this
 * org's records measured 182 seconds — 26,000 leads, 8,000 opportunities and their
 * contacts, accounts and activity, at 200 records a page — inside a single 300s function
 * that also had ten other providers to get through. It did not fit, and the way it failed
 * was the worst available: the function was killed mid-provider, so neither branch of the
 * try/catch in sync() ran, the integration row stayed on `syncing`, the card derived
 * "Sync stalled", and the sync_run row went on claiming to be running for ever. The
 * provider declares `ownSchedule`, which keeps it out of that run and brings it here.
 *
 * An hour before the shared cron rather than after it, because the two things that read
 * this data run at 02:30 and 03:00 — the packs and the digest — and a digest written from
 * yesterday's pipeline is worse than a late one.
 *
 * Authenticated exactly as the nightly cron is, and refuses to run when CRON_SECRET is
 * unset for the same reason: running openly when the variable is missing turns one
 * forgotten env var into an endpoint anyone can use to hammer the CRM.
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

  try {
    const result = await sync('zoho_crm', 30);

    // Every CRM page reads Lead, Contact and Opportunity, and the dashboard reads the
    // metric rows. Both have just been rewritten; without this they show yesterday's
    // pipeline until the TTL expires.
    await invalidate(TAGS.integrations, TAGS.metrics);

    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
      rows: result.rows,
      // False means the pull ran out of budget with records still to fetch. Not a
      // failure: it keeps its cursor and resumes tomorrow. Reported so a backfill that
      // never finishes is visible rather than looking like a clean nightly import.
      done: result.done,
      detail: result.detail,
    });
  } catch (e) {
    const reason = (e as Error).message;
    // Logged as well as returned: the response goes to the scheduler, which nobody reads
    // unless something breaks. The log is where a failure is actually noticed.
    console.error('[cron/zoho] failed:', reason);
    return NextResponse.json({ ok: false, ms: Date.now() - started, error: reason }, { status: 500 });
  }
}
