import { z } from 'zod';
import { body, route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { signOffSequence } from '@/lib/outreach/outreach';

const input = z.object({
  kind: z.enum(['copy', 'numbers']),
  granted: z.boolean(),
});

/**
 * Signing off a template, or withdrawing a sign-off.
 *
 * Gated on `approve`, which only an owner holds. That is the single line the manual's
 * Part V turns on: an admin can build the campaign, write the registry row and run it,
 * and still not be the person who says it may go out.
 *
 * Both acts are recorded — copy approval and figure verification — because they are
 * different competences, and a template can be well written and factually wrong.
 */
export const POST = route<unknown, Ctx>('approve', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { kind, granted } = await body(req, input);

  // IneligibleError becomes a 422 in lib/platform/api.ts's route(): a refusal to sign a template
  // that still has placeholders in it is a message for the person, not a server fault.
  const result = await signOffSequence(id, kind, granted, user.email);
  if (!result) throw new HttpError(404, 'Sequence not found');
  return result;
});
