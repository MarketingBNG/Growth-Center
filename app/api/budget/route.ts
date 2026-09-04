import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { BudgetError, envelopesFor, quarterOf, setEnvelope } from '@/lib/budget';
import { TAGS, invalidate } from '@/lib/cache';

// The budget envelope. §22: Akshay sets it by channel, once a quarter, recorded with his
// identity.
//
// Behind `settings:manage`, which the owner alone holds — the same tier as the reporting
// currency and the thresholds, and for the same reason: it is an instruction the rest of
// the application computes against, not a preference.

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');

export const GET = route('growth:read', async (_user, req) => {
  const url = new URL(req.url);
  const start = url.searchParams.get('periodStart');
  const end = url.searchParams.get('periodEnd');

  // Defaults to the quarter we are in, which is the period somebody opening this is
  // almost always asking about.
  const period =
    start && end
      ? { periodStart: start, periodEnd: end }
      : quarterOf(new Date());

  return { period, envelopes: await envelopesFor(period.periodStart, period.periodEnd) };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({
      channelId: z.string().min(1),
      periodStart: iso,
      periodEnd: iso,
      amount: z.number().min(0).finite(),
      currency: z.string().length(3),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  );

  try {
    const saved = await setEnvelope(
      {
        channelId: input.channelId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        note: input.note ?? null,
      },
      user.email,
    );

    // The envelope rule and the marketing page both compute against this.
    await invalidate(TAGS.metrics);
    return { id: saved.id };
  } catch (e) {
    if (e instanceof BudgetError) throw new HttpError(422, e.message);
    throw e;
  }
});
