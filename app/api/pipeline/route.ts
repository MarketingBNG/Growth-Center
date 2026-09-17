import { z } from 'zod';
import { parseQuery, route } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { board } from '@/lib/pipeline/pipeline';

export const GET = route('growth:read', async (_user, req) => {
  const { pipelineId } = parseQuery(req, z.object({ pipelineId: z.string().optional() }));
  const result = await board(pipelineId);
  if (!result) throw new HttpError(404, 'No pipeline configured. Connect a CRM integration, or create a pipeline first.');
  return result;
});
