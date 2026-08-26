import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { canonicalEmail } from '@/lib/roles';
import { setActive } from '@/lib/users';

const input = z.object({
  email: z.string().trim().email(),
  active: z.boolean(),
});

export const PATCH = route('settings:manage', async (user, req) => {
  const { email, active } = await body(req, input);

  const target = canonicalEmail(email);
  if (!target) throw new HttpError(422, 'Not a company address.');

  // Locking yourself out is always a mistake, and with no admin tier there may be
  // nobody left who can undo it from the UI.
  if (target === user.email && !active) {
    throw new HttpError(422, 'You cannot deactivate your own account.');
  }

  await setActive(target, active);
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: active ? 'user.activate' : 'user.deactivate',
      entityType: 'app_user',
      detail: { email: target },
    },
  });

  return { ok: true };
});
