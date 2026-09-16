import { hasDb } from './prisma.ts';

/**
 * The pure decision behind every `/api/cron/*` route's auth check: no NextResponse, so it
 * can be unit-tested with bare Node the way `route()` in lib/api.ts cannot be (see
 * tools/api.test.ts's comment on that same limitation — next/server does not resolve
 * outside a Next.js build). `cronGuard` in lib/cron-auth.ts wraps this for actual routes.
 *
 * Refuses to run when CRON_SECRET is unset, rather than running openly. The alternative —
 * treating a missing secret as "no auth configured, allow it" — turns one forgotten env
 * var into a public endpoint that hammers third-party APIs, sends mail, or (for
 * sync-provider) runs an arbitrary provider sync on demand. Failing closed costs nothing
 * when the variable is set, which it always should be in a real deployment.
 *
 * Returns the refusal (status + message), or `null` to proceed.
 */
export function cronCheck(req: Request): { status: 401 | 503; error: string } | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { status: 503, error: 'CRON_SECRET is not set' };
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return { status: 401, error: 'Unauthorised' };
  }
  if (!hasDb()) return { status: 503, error: 'No database configured' };
  return null;
}
