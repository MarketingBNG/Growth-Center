import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { disconnect } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<unknown, Ctx>('integrations:manage', async (user, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    return await disconnect(id, user.email);
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
