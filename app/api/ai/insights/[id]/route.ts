import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { INSIGHT_STATUSES } from '@/lib/insight-lifecycle';
import { TransitionError, setInsightStatus } from '@/lib/insight-actions';

// Moving a finding through its lifecycle: proposed → reviewed → assigned → in progress →
// done, or dismissed with a reason at almost any point.
//
// Everything the transition implies — the owner, the note, `dismissedAt`, the audit row —
// is written by setInsightStatus rather than here, so the HTTP layer cannot produce a
// state the domain would refuse.

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<unknown, Ctx>('ai:run', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = await body(
    req,
    z.object({
      status: z.enum(INSIGHT_STATUSES),
      ownerEmail: z.string().trim().email().optional().nullable(),
      reviewNote: z.string().trim().max(1000).optional().nullable(),
    }),
  );

  try {
    const result = await setInsightStatus(
      id,
      { to: input.status, ownerEmail: input.ownerEmail, reviewNote: input.reviewNote },
      user.email,
    );
    if (!result) throw new HttpError(404, 'No such insight.');
    return result;
  } catch (e) {
    // 422, not 500: a refused transition is the domain working. The message is the one
    // the rule wrote, because it says which requirement was missed.
    if (e instanceof TransitionError) throw new HttpError(422, e.message);
    throw e;
  }
});
