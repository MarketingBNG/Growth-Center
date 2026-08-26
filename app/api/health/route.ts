import { NextResponse } from 'next/server';
import { hasDb, prisma } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';
import { currentUser } from '@/lib/auth';

/**
 * Liveness probe. Unauthenticated, because a probe that needs a session is useless to a
 * load balancer.
 *
 * The anonymous response is deliberately just liveness and database reachability. It used
 * to enumerate which of GOOGLE_CLIENT_*, APP_ENCRYPTION_KEY and ANTHROPIC_API_KEY were
 * set — no secret values, but it told any anonymous caller how the deployment was
 * configured, which is a free reconnaissance step. The detailed form now requires a
 * session; the Settings page is where a signed-in user sees configuration state anyway.
 */
export async function GET() {
  let dbReachable: boolean | null = null;
  const client = prisma();
  if (client) {
    try {
      await client.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: true, database: { reachable: dbReachable } });
  }

  return NextResponse.json({
    ok: true,
    database: { configured: hasDb(), reachable: dbReachable },
    googleAuth: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    encryptionKey: hasEncryptionKey(),
    ai: !!process.env.ANTHROPIC_API_KEY,
  });
}
