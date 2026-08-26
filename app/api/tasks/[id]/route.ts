import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { completeTask, reopenTask } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

// POST stays "complete" — it is what the existing Done buttons call.
export const POST = route<unknown, Ctx>('crm:write', async (user, _req, ctx) => {
  const result = await completeTask((await ctx.params).id, user.email);
  if (!result) throw new HttpError(404, 'Task not found');
  return result;
});

// PATCH takes the state explicitly, so a task ticked off by mistake can be reopened.
export const PATCH = route<unknown, Ctx>('crm:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { status } = await body(req, z.object({ status: z.enum(['open', 'done']) }));

  const result =
    status === 'done' ? await completeTask(id, user.email) : await reopenTask(id, user.email);

  if (!result) throw new HttpError(404, 'Task not found');
  return result;
});
