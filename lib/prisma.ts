import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

const g = globalThis as unknown as { _prisma?: PrismaClient | null };

/**
 * Null when DATABASE_URL is unset, so the app boots and pages render an "no database
 * configured" state instead of crashing on a cold start. Every caller handles null.
 *
 * Uses the node-postgres adapter rather than Neon's HTTP one. The HTTP adapter cannot
 * open transactions at all — it rejects every $transaction call, nested writes
 * included — and lead conversion needs them.
 */
export function prisma(): PrismaClient | null {
  if (g._prisma !== undefined) return g._prisma;

  const url = process.env.DATABASE_URL;
  if (!url) {
    g._prisma = null;
    return null;
  }

  try {
    g._prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  } catch (e) {
    console.error('[prisma] could not build a client:', (e as Error).message);
    g._prisma = null;
  }
  return g._prisma;
}

/** Throws where a missing database is a bug rather than a state to render. */
export function db(): PrismaClient {
  const client = prisma();
  if (!client) throw new Error('DATABASE_URL is not set');
  return client;
}

export const hasDb = () => !!process.env.DATABASE_URL;
