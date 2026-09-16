import { z } from 'zod';
import { body, route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { APPROVAL_STATE, INSIGHT_STATUSES } from '@/lib/insights/insight-lifecycle';
import { setInsightStatus } from '@/lib/insights/insight-actions';
import { can } from '@/lib/access/roles';

// Moving a finding through its lifecycle: proposed → reviewed → approved → assigned →
// in progress → done, or dismissed with a reason at almost any point.
//
// Everything the transition implies — the owner, the note, `dismissedAt`, the audit row —
// is written by setInsightStatus rather than here, so the HTTP layer cannot produce a
// state the domain would refuse.

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

  // The one transition that is a signature rather than a move. `ai:run` is what the rest
  // of the lifecycle needs — anyone working the queue may review, assign and close — but
  // §5.1 gives approval to one identity, and lib/access/roles.ts has carried an `approve`
  // permission since the policy was written with a note saying nothing called it. This is
  // the call site.
  if (input.status === APPROVAL_STATE && !can(user.role, 'approve')) {
    throw new HttpError(403, 'Only the approver can sign a finding off.');
  }

  // TransitionError becomes a 422 in lib/platform/api.ts's route(): a refused transition is the
  // domain working, and the message is the one the rule wrote — it says which
  // requirement was missed.
  const result = await setInsightStatus(
    id,
    { to: input.status, ownerEmail: input.ownerEmail, reviewNote: input.reviewNote },
    user.email,
  );
  if (!result) throw new HttpError(404, 'No such insight.');
  return result;
});
