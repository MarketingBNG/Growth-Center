import { body, route } from '@/lib/api';
import { createOpportunity, opportunityInput } from '@/lib/pipeline';

export const POST = route('pipeline:write', async (user, req) => {
  return createOpportunity(await body(req, opportunityInput), user.email);
});
