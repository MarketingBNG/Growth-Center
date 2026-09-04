import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { db } from '@/lib/prisma';

// Dismissing a finding, and undoing that.
//
// `dismissedAt` has been filtered on by both pages that render insights since the column
// existed, and nothing ever wrote it — so the filter was a no-op and there was no way to
// clear a finding you had decided not to act on. It only becomes worth having now that
// findings survive a regeneration: before, a dismissal lasted until the next run.

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<unknown, Ctx>('ai:run', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, z.object({ dismissed: z.boolean() }));

  const insight = await db().aiInsight.findUnique({
    where: { id },
    select: { id: true, title: true, dismissedAt: true },
  });
  if (!insight) throw new HttpError(404, 'No such insight.');

  const dismissedAt = input.dismissed ? new Date() : null;
  await db().aiInsight.update({ where: { id }, data: { dismissedAt } });

  // Recorded because dismissing a finding is a judgement that it is not worth acting on,
  // and the next person to wonder why the page is quiet about something is entitled to
  // find out who decided that.
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: input.dismissed ? 'insight.dismiss' : 'insight.restore',
      entityType: 'ai_insight',
      entityId: id,
      detail: { title: insight.title },
    },
  });

  return { id, dismissedAt };
});
