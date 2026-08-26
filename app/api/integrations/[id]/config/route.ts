import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { setConfig } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';

type Ctx = { params: Promise<{ id: string }> };

// Non-secret settings only. Anything sealed goes through connect().
const input = z.object({
  config: z.record(z.string(), z.string().max(200)),
});

export const PATCH = route<unknown, Ctx>('integrations:manage', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { config } = await body(req, input);

  try {
    return { config: await setConfig(id, config, user.email) };
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
