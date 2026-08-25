import { z } from 'zod';
import { body, listQuery, paged, parseQuery, route } from '@/lib/api';
import { createTask, taskInput } from '@/lib/crm';
import { db } from '@/lib/prisma';

const filters = listQuery.extend({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  assigneeEmail: z.string().trim().optional(),
});

export const GET = route('growth:read', async (_user, req) => {
  const q = parseQuery(req, filters);
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.assigneeEmail) where.assigneeEmail = q.assigneeEmail;

  const [rows, total] = await Promise.all([
    db().task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        opportunity: { select: { id: true, name: true } },
      },
    }),
    db().task.count({ where }),
  ]);
  return paged(rows, total, q);
});

export const POST = route('crm:write', async (user, req) => {
  return createTask(await body(req, taskInput), user.email);
});
