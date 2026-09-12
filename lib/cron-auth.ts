import { NextResponse } from 'next/server';
import { cronCheck } from './cron-check.ts';

/**
 * The auth check every `/api/cron/*` route opens with. There is no session behind a
 * scheduler invocation — Vercel calls these directly — so each authenticates with
 * CRON_SECRET as a bearer token instead of `route()`'s session check. The decision
 * itself, and why it fails closed, lives in cron-check.ts; this just turns the refusal
 * into the response a route hands back.
 *
 * Returns the refusal response, or `null` to proceed.
 */
export function cronGuard(req: Request): NextResponse | null {
  const refusal = cronCheck(req);
  return refusal ? NextResponse.json({ error: refusal.error }, { status: refusal.status }) : null;
}
