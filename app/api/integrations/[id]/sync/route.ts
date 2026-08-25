import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { sync } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<unknown, Ctx>('integrations:manage', async (_user, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    return await sync(id);
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
