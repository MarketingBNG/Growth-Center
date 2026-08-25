import { z } from 'zod';
import { body, route } from '@/lib/api';
import { generateApiKey } from '@/lib/crypto';
import { db } from '@/lib/prisma';

export const GET = route('apikeys:manage', async () => {
  // Deliberately never selects `hash`.
  const keys = await db().apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, prefix: true, createdByEmail: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return { keys };
});

export const POST = route('apikeys:manage', async (user, req) => {
  const { name } = await body(req, z.object({ name: z.string().trim().min(1).max(80) }));

  const { plaintext, hash, prefix } = generateApiKey();
  await db().apiKey.create({ data: { name, hash, prefix, createdByEmail: user.email } });
  await db().auditEvent.create({
    data: { actorEmail: user.email, action: 'apikey.create', entityType: 'api_key', detail: { name, prefix } },
  });

  // The only time the plaintext leaves the server.
  return { key: plaintext, prefix };
});
