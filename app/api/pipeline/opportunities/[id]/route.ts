import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { moveOpportunity } from '@/lib/pipeline';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<unknown, Ctx>('pipeline:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { stageId } = await body(req, z.object({ stageId: z.string().min(1) }));

  const result = await moveOpportunity(id, stageId, user.email);
  if (!result.ok) {
    throw new HttpError(result.reason === 'not_found' ? 404 : 422, result.reason.replaceAll('_', ' '));
  }
  return result;
});
