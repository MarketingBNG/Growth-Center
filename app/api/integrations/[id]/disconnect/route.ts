import { route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { disconnect } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';
import { TAGS, invalidate } from '@/lib/platform/cache';

export const POST = route<unknown, Ctx>('integrations:manage', async (user, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    const result = await disconnect(id, user.email);
    await invalidate(TAGS.integrations);
    return result;
  } catch (e) {
    // 422 here, deliberately not the 502 lib/platform/api.ts's route() gives an uncaught
    // IntegrationError elsewhere: disconnecting an id nothing recognises is the caller
    // asking for something that does not exist, not a vendor refusing a write.
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
