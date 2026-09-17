import { body, route } from '@/lib/platform/api';
import { contentInput, createContent } from '@/lib/content/content';

export const POST = route('content:write', async (user, req) => {
  return createContent(await body(req, contentInput), user.email);
});
