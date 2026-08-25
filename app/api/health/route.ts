import { NextResponse } from 'next/server';
import { hasDb, prisma } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';

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

  return NextResponse.json({
    ok: true,
    database: { configured: hasDb(), reachable: dbReachable },
    googleAuth: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    encryptionKey: hasEncryptionKey(),
    ai: !!process.env.ANTHROPIC_API_KEY,
  });
}
