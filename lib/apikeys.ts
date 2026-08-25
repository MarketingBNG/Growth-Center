import { db } from './prisma.ts';
import { hashApiKey } from './crypto.ts';

/**
 * Resolves an X-API-Key header to a live key row, or null.
 *
 * Looks the key up BY HASH rather than reading every row and comparing — the hash
 * column is unique and indexed, so an attacker learns nothing from timing and the
 * query stays O(1) as keys accumulate.
 */
export async function verifyApiKey(header: string | null) {
  const plaintext = (header ?? '').trim();
  if (!plaintext.startsWith('gc_')) return null;

  const key = await db().apiKey.findUnique({
    where: { hash: hashApiKey(plaintext) },
    select: { id: true, name: true, revokedAt: true },
  });
  if (!key || key.revokedAt) return null;

  // Fire and forget: a failed timestamp update must not reject a valid lead.
  db()
    .apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return key;
}
