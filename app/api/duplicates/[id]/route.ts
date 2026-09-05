import { z } from 'zod';
import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { MergeError, dismissDuplicate, mergeDuplicate } from '@/lib/duplicate-queue';
import { TAGS, invalidate } from '@/lib/cache';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Resolve one pair: merge it, or say why it is not a duplicate.
 *
 * A dismissal must carry a reason. Same argument §20.2 makes about dismissing a finding —
 * a dismissal with no note is indistinguishable from somebody clearing their screen, and
 * the note is what stops the next scan proposing the pair for ever.
 */
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge') }),
  z.object({ action: z.literal('dismiss'), reason: z.string().trim().min(3) }),
]);

export const POST = route<unknown, Ctx>('crm:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = body.parse(await req.json());

  try {
    if (input.action === 'merge') {
      const merged = await mergeDuplicate(id, user.email);
      await invalidate(TAGS.metrics);
      return merged;
    }
    await dismissDuplicate(id, input.reason, user.email);
    await invalidate(TAGS.metrics);
    return { dismissed: id };
  } catch (e) {
    // 422 rather than 500: "already resolved" and "company merges are not automated" are
    // both answers to the request, not failures of the server.
    if (e instanceof MergeError) throw new HttpError(422, e.message);
    throw e;
  }
});
