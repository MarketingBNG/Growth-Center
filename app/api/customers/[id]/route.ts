import { z } from 'zod';
import { route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { TAGS, invalidate } from '@/lib/cache';

type Ctx = { params: Promise<{ id: string }> };

/**
 * §8.2's four lifecycle dates.
 *
 * Nullable on purpose: recording a review request and then discovering it never happened
 * has to be undoable, and a flag that can only be set is a flag that drifts one way.
 *
 * Nothing here is inferred from activity. A call logged against an account is not
 * evidence that a referral was asked for, and treating it as such would fill the register
 * with work nobody did.
 */
const body = z.object({
  reviewRequestedAt: z.string().datetime().nullable().optional(),
  referralAskedAt: z.string().datetime().nullable().optional(),
  crossSellOfferedAt: z.string().datetime().nullable().optional(),
  renewalDueAt: z.string().datetime().nullable().optional(),
});

const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

export const PATCH = route<unknown, Ctx>('crm:write', async (_user, req, ctx) => {
  const { id } = await ctx.params;
  const input = body.parse(await req.json());

  const updated = await db().customer.update({
    where: { id },
    data: {
      reviewRequestedAt: date(input.reviewRequestedAt),
      referralAskedAt: date(input.referralAskedAt),
      crossSellOfferedAt: date(input.crossSellOfferedAt),
      renewalDueAt: date(input.renewalDueAt),
    },
    select: { id: true },
  });

  await invalidate(TAGS.metrics);
  return updated;
});
