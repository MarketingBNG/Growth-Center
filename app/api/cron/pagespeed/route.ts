import { NextResponse } from 'next/server';
import { sync } from '@/lib/integrations/service';
import { hasDb } from '@/lib/prisma';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * Weekly Core Web Vitals measurement. Scheduled in vercel.json.
 *
 * Separate from /api/cron/sync because PageSpeed cannot share it. One call takes 17-51
 * seconds — Google runs a full Lighthouse pass in a real browser — and a measured run
 * covered 22 pages in 237 seconds. `syncAll` runs providers one after another inside a
 * single 300s function, so leaving this in it would have spent the entire nightly budget
 * on PageSpeed and quietly stopped every other integration from syncing. The provider
 * declares `ownSchedule`, which is what keeps it out of that run and brings it here.
 *
 * Weekly rather than nightly because the data barely moves: the field half comes from
 * CrUX, which is a 28-day rolling average, so measuring it daily would mostly re-record
 * the same numbers at a minute of API time per page.
 *
 * Authenticated exactly as the nightly cron is, and refuses to run when CRON_SECRET is
 * unset for the same reason: running openly when the variable is missing turns one
 * forgotten env var into an endpoint anyone can use to spend the API quota.
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
    const result = await sync('pagespeed', 30);

    // The SEO page reads both the metric rows and SeoPage.issues, and both have just been
    // rewritten. Without this the page shows last week's figures until the TTL expires.
    await invalidate(TAGS.integrations, TAGS.metrics, TAGS.seo);

    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
      rows: result.rows,
      // False means the pass ran out of budget with pages still to measure. Not a failure:
      // it keeps its cursor and finishes on the next run. Reported so a pass that never
      // completes is visible rather than looking like a successful weekly measurement.
      done: result.done,
      detail: result.detail,
    });
  } catch (e) {
    const reason = (e as Error).message;
    // Logged as well as returned: the response goes to the scheduler, which nobody reads
    // unless something breaks. The log is where a failure is actually noticed.
    console.error('[cron/pagespeed] failed:', reason);
    return NextResponse.json({ ok: false, ms: Date.now() - started, error: reason }, { status: 500 });
  }
}
