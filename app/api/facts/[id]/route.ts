import { z } from 'zod';
import { route } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { can } from '@/lib/access/roles';
import { proposeFact, reviewFact } from '@/lib/content/facts-store';

// Moving a fact through the register.
//
// Two actions behind one route, separated by permission rather than by path, because the
// distinction that matters is who may do it:
//
//   propose  — content:write. Putting your own work in front of a reviewer.
//   approve  — the `approve` permission, which POLICY grants to the owner alone. This is
//              the CA/CPA clearance the whole facts rule rests on.
//
// The route itself is gated on the lower of the two and checks the higher one inside.
// Gating it on `approve` would stop a writer proposing; gating it on content:write and
// trusting the body would let a writer clear a tax number by sending a different action to
// the same endpoint. The store refuses the rest — nobody clears a fact they entered.
//
// FactError maps to 422 through DOMAIN_422 in lib/platform/api.ts, so there is no
// try/catch here restating that.

const input = z.object({
  action: z.enum(['propose', 'approve', 'refuse']),
  note: z.string().trim().max(2000).nullish(),
});

export const PATCH = route<unknown, { params: Promise<{ id: string }> }>(
  'content:write',
  async (user, req, ctx) => {
    const { id } = await ctx.params;
    const parsed = input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, 'Say whether to propose, approve or refuse.');

    const { action, note } = parsed.data;
    if (action === 'propose') return proposeFact(id, user.email);

    if (!can(user.role, 'approve')) {
      throw new HttpError(403, 'Only an owner may clear a fact. This is the CA/CPA sign-off.');
    }
    return reviewFact(id, action, user.email, note);
  },
);
