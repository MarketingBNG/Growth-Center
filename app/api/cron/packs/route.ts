import { NextResponse } from 'next/server';
import { cronGuard } from '@/lib/platform/cron-auth';
import { packsDue, sendPack } from '@/lib/reports/packs';

/**
 * §12.6's scheduled packs: Shweta on a Monday, Akshay on the first working day. K7.
 *
 * 02:30 UTC is 08:00 IST, which is the hour §12.6 names, and half an hour ahead of the
 * digest so the pack arrives first.
 *
 * Runs every day and sends nothing on most of them. That is the design rather than a
 * compromise: "the first working day of the month" is a rule about a calendar and a cron
 * expression can only describe an interval, so the calendar rule lives in `packsDue`,
 * where it is a pure function with tests, instead of in a schedule string nobody can check.
 *
 * Its own cron rather than a tail on the digest, for the reason that route already gives:
 * a run that fails takes everything after it silently, and the symptom of a missing email
 * is that nobody notices.
 *
 * Authenticated the same way as the sync and the digest — see cronGuard.
 */
export const maxDuration = 60;

function baseUrl(req: Request): string {
  // The configured URL first: on Vercel the request host for a cron invocation is the
  // deployment's own hostname, so a link built from it points at one immutable deployment
  // rather than at the app.
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const refusal = cronGuard(req);
  if (refusal) return refusal;

  const now = new Date();
  const due = packsDue(now);
  if (due.length === 0) {
    return NextResponse.json({ ok: true, due: [], skipped: 'not a pack day' });
  }

  // One pack failing must not take the other with it. The first working day of a month
  // can also be a Monday, and that is the day both readers are expecting something.
  const results = [];
  for (const pack of due) {
    try {
      results.push(await sendPack(pack, baseUrl(req), now));
    } catch (e) {
      const error = e instanceof Error ? e.message : 'unknown';
      console.error(`[cron/packs] ${pack.id} failed:`, e);
      results.push({ pack: pack.id, sent: 0, recipients: [], errors: [error] });
    }
  }

  // Logged as well as returned. The response goes to the scheduler, which nobody reads
  // unless they already suspect something; a failed send has to be findable afterwards.
  const errors = results.flatMap((r) => r.errors);
  if (errors.length) console.error('[cron/packs] send failures:', JSON.stringify(errors));

  return NextResponse.json({ ok: errors.length === 0, results });
}
