import { z } from 'zod';
import { body, route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { convertLead } from '@/lib/pipeline/pipeline';

export const POST = route<unknown, Ctx>('pipeline:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { value } = await body(req, z.object({ value: z.number().nonnegative().default(0) }));

  const result = await convertLead(id, user.email, value);
  if (!result.ok) {
    throw new HttpError(result.reason === 'not_found' ? 404 : 409, result.reason.replaceAll('_', ' '));
  }
  return result;
});
