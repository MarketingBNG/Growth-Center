import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { sync } from '@/lib/integrations/service';
import { IntegrationError } from '@/lib/integrations/types';
import { TAGS, invalidate } from '@/lib/cache';

type Ctx = { params: Promise<{ id: string }> };

/**
 * One slice of a sync, not necessarily the whole thing.
 *
 * A provider with tens of thousands of records returns `done: false` once it runs out of
 * budget; the caller comes straight back and it resumes from its cursor. The ceiling is
 * raised anyway so each slice gets a useful amount of work done.
 */
export const maxDuration = 300;

export const POST = route<unknown, Ctx>('integrations:manage', async (_user, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    const result = await sync(id);
    await invalidate(TAGS.integrations, TAGS.metrics, TAGS.seo, TAGS.social);
    return result;
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});
