import { z } from 'zod';
import { route } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { createFact, listFacts } from '@/lib/content/facts-store';
import { JURISDICTIONS } from '@/lib/content/facts-fields';

// The verified facts register.
//
// Entering a fact is content:write — it is research, and anyone who writes may do it.
// Clearing one is the `approve` permission and lives on the [id] route, because an
// approval is a different act by a different person.

const input = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(200),
  numericValue: z.number().finite().nullish(),
  unit: z.string().trim().max(40).nullish(),
  jurisdiction: z.enum(JURISDICTIONS),
  authority: z.string().trim().max(200).nullish(),
  sourceUrl: z.string().trim().min(1).max(2000),
  sourceExcerpt: z.string().trim().min(1).max(4000),
  effectiveFrom: z.coerce.date().nullish(),
  effectiveTo: z.coerce.date().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const GET = route('growth:read', async () => ({ facts: await listFacts() }));

export const POST = route('content:write', async (user, req) => {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new HttpError(422, parsed.error.issues[0]?.message ?? 'That fact is not complete.');
  }
  // FactError maps to 422 through DOMAIN_422 in lib/platform/api.ts, and its messages are
  // written for the person entering the fact, so they reach them unaltered.
  return createFact(parsed.data, user.email);
});
