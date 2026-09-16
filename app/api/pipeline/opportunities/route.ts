import { body, route } from '@/lib/platform/api';
import { createOpportunity, opportunityInput } from '@/lib/pipeline/pipeline';

export const POST = route('pipeline:write', async (user, req) => {
  return createOpportunity(await body(req, opportunityInput), user.email);
});
