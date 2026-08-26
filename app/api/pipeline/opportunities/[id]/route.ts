import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { moveOpportunity, opportunityPatch, updateOpportunity } from '@/lib/pipeline';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<unknown, Ctx>('pipeline:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  // Two shapes on one route: a stage move, or an edit of the deal's own fields. A move
  // has to stay separate because it emits the won/lost events that create and reverse
  // revenue — an edit must never trigger those.
  const input = await body(
    req,
    z.union([z.object({ stageId: z.string().min(1) }), opportunityPatch]),
  );

  if ('stageId' in input && typeof input.stageId === 'string') {
    const result = await moveOpportunity(id, input.stageId, user.email);
    if (!result.ok) {
      throw new HttpError(
        result.reason === 'not_found' ? 404 : 422,
        result.reason.replaceAll('_', ' '),
      );
    }
    return result;
  }

  const updated = await updateOpportunity(id, input as z.infer<typeof opportunityPatch>, user.email);
  if (!updated) throw new HttpError(404, 'Opportunity not found');
  return updated;
});
