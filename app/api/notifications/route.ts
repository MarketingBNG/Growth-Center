import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';

// The bell was a dead button with a hardcoded unread dot, while sync failures wrote
// notification rows no page ever read.

export const GET = route(null, async (user) => {
  const where = { OR: [{ forEmail: null }, { forEmail: user.email }] };

  const [items, unread] = await Promise.all([
    db().notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, body: true, level: true, href: true, readAt: true, createdAt: true },
    }),
    db().notification.count({ where: { ...where, readAt: null } }),
  ]);

  return { items, unread };
});

export const PATCH = route(null, async (user, req) => {
  const { id } = await body(req, z.object({ id: z.string().cuid().optional() }));
  const mine = { OR: [{ forEmail: null }, { forEmail: user.email }] };

  // No id means "mark everything read" — the usual action on opening the panel.
  await db().notification.updateMany({
    where: { ...mine, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });

  return { ok: true };
});
