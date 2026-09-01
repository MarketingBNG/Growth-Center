import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { setConfig } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';
import { TAGS, invalidate } from '@/lib/cache';

type Ctx = { params: Promise<{ id: string }> };

// Non-secret settings only. Anything sealed goes through connect().
const input = z.object({
  config: z.record(z.string(), z.string().max(200)),
});

export const PATCH = route<unknown, Ctx>('integrations:manage', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { config } = await body(req, input);

  try {
    const updated = await setConfig(id, config, user.email);
    await invalidate(TAGS.integrations);
    return { config: updated };
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
