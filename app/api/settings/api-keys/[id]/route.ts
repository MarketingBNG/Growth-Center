import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { db } from '@/lib/prisma';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<unknown, Ctx>('apikeys:manage', async (user, _req, ctx) => {
  const { id } = await ctx.params;

  const key = await db().apiKey.findUnique({ where: { id }, select: { revokedAt: true, name: true } });
  if (!key) throw new HttpError(404, 'Key not found');
  if (key.revokedAt) return { ok: true, alreadyRevoked: true };

  // Revoked, not deleted: the audit trail should still show the key existed and was used.
  await db().apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await db().auditEvent.create({
    data: { actorEmail: user.email, action: 'apikey.revoke', entityType: 'api_key', entityId: id, detail: { name: key.name } },
  });
  return { ok: true };
});
