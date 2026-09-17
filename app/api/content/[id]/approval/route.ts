import { z } from 'zod';
import { body, route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { approveContent, returnContent } from '@/lib/content/content';

// Approving a content piece, or sending it back. §21.2.
//
// Behind `approve`, which the owner alone holds. This is the first thing in the
// application to check that permission — it has existed since roles became assignable
// and nothing consulted it, which meant "Shweta is the only approving identity" was a
// sentence in a document with no code behind it.
//
// Both actions live on one route because they are one decision with two outcomes, and a
// caller should not be able to reach for one without the other being right there.

export const POST = route<unknown, Ctx>('approve', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = await body(
    req,
    z.discriminatedUnion('decision', [
      z.object({ decision: z.literal('approve') }),
      // The note is required by the schema as well as by the domain, so the error a
      // caller gets names the field rather than describing the rule.
      z.object({ decision: z.literal('return'), note: z.string().trim().min(1).max(1000) }),
    ]),
  );

  // ApprovalError becomes a 422 in lib/platform/api.ts's route(): approving or returning a piece
  // that is not awaiting approval is a refusal, not a server fault.
  const result =
    input.decision === 'approve'
      ? await approveContent(id, user.email)
      : await returnContent(id, input.note, user.email);
  if (!result) throw new HttpError(404, 'Content piece not found');
  return result;
});
