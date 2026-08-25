import { body, route } from '@/lib/api';
import { contentInput, createContent } from '@/lib/content';

export const POST = route('content:write', async (_user, req) => {
  return createContent(await body(req, contentInput));
});
