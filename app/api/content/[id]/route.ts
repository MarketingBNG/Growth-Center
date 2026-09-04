import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { setContentStatus } from '@/lib/content';
import { CONTENT_STATUSES } from '@/lib/enums';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<unknown, Ctx>('content:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { status } = await body(req, z.object({ status: z.enum(CONTENT_STATUSES) }));
  const result = await setContentStatus(id, status, user.email);
  if (!result) throw new HttpError(404, 'Content piece not found');
  return result;
});
