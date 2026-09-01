import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { disconnect } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';
import { TAGS, invalidate } from '@/lib/cache';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<unknown, Ctx>('integrations:manage', async (user, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    const result = await disconnect(id, user.email);
    await invalidate(TAGS.integrations);
    return result;
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
