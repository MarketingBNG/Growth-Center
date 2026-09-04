import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { IneligibleError, signOffSequence } from '@/lib/outreach';

type Ctx = { params: Promise<{ id: string }> };

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

  try {
    const result = await signOffSequence(id, kind, granted, user.email);
    if (!result) throw new HttpError(404, 'Sequence not found');
    return result;
  } catch (e) {
    // A refusal to sign a template that still has placeholders in it is a message for the
    // person, not a server fault.
    if (e instanceof IneligibleError) throw new HttpError(422, e.message);
    throw e;
  }
});
