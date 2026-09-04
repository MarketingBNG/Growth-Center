import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { ROLE_VALUES, canAdminister, canonicalEmail, isAdmin, type Role } from '@/lib/roles';
import { renameUser, setActive, setRole } from '@/lib/users';

const input = z
  .object({
    email: z.string().trim().email(),
    active: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(ROLE_VALUES as [Role, ...Role[]]).optional(),
  })
  .refine((v) => v.active !== undefined || v.name !== undefined || v.role !== undefined, {
    message: 'Nothing to change.',
  });

export const PATCH = route('settings:manage', async (user, req) => {
  const { email, active, name, role } = await body(req, input);

  const target = canonicalEmail(email);
  if (!target) throw new HttpError(422, 'Not a company address.');

  try {
    if (name !== undefined) {
      await renameUser(target, name);
      await db().auditEvent.create({
        data: {
          actorEmail: user.email,
          action: 'user.rename',
          entityType: 'app_user',
          detail: { email: target, name },
        },
      });
    }

    if (role !== undefined) {
      // Same reasoning as the revoke guard below: demoting yourself out of settings
      // access could leave nobody able to put it back, and there is no tier above.
      if (target === user.email && !canAdminister(role)) {
        throw new HttpError(422, 'You cannot move yourself to a role that cannot manage settings.');
      }

      await setRole(target, role);
      await db().auditEvent.create({
        data: {
          actorEmail: user.email,
          action: 'user.role',
          entityType: 'app_user',
          detail: { email: target, role },
        },
      });
    }

    if (active !== undefined) {
      // Locking yourself out is always a mistake, and with no tier above you there may
      // be nobody left who can undo it from the UI. setActive() guards the admin too.
      if (target === user.email && !active) {
        throw new HttpError(422, 'You cannot revoke your own access.');
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
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, (e as Error).message);
  }

  return { ok: true, isAdmin: isAdmin(target) };
});
