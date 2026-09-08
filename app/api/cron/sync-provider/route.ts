import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { driveSync, MAX_CHAIN_HOPS } from '@/lib/integrations/driver';
import { hasDb } from '@/lib/prisma';

/**
 * One more invocation's worth of a sync that has not finished.
 *
 * A backfill of tens of thousands of records needs more wall clock than any single
 * serverless invocation gets, so the driver stops before the platform kills it and calls
 * this to continue in a fresh one. Nothing else calls it.
 *
 * Not wrapped in route(): there is no session behind a continuation — the person who
 * pressed Sync now may have closed the tab, which is the whole point. It authenticates
 * with CRON_SECRET, the same way the nightly cron does, and refuses to run when the
 * variable is unset rather than becoming an open endpoint that hammers a vendor's API.
 */
export const maxDuration = 300;

const Body = z.object({
  provider: z.string().min(1),
  days: z.number().int().positive().max(3650).default(30),
  actorEmail: z.string().nullable().default(null),
  hop: z.number().int().min(0).max(MAX_CHAIN_HOPS).default(0),
});

export async function POST(req: Request) {
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

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid body', detail: e instanceof z.ZodError ? z.treeifyError(e) : undefined },
      { status: 422 },
    );
  }

  // Answered before the work starts, for the same reason the sync endpoint is: the caller
  // is a driver about to be killed, and holding its request open until this sync finishes
  // would mean the two invocations overlap for their whole length instead of handing over.
  after(() =>
    driveSync(parsed.provider, {
      days: parsed.days,
      actorEmail: parsed.actorEmail,
      hop: parsed.hop,
    }),
  );

  return NextResponse.json({ accepted: true, provider: parsed.provider, hop: parsed.hop });
}
