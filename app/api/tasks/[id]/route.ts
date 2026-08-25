import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { completeTask } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<unknown, Ctx>('crm:write', async (user, _req, ctx) => {
  const result = await completeTask((await ctx.params).id, user.email);
  if (!result) throw new HttpError(404, 'Task not found');
  return result;
});
