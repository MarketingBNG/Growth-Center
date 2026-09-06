import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { OWNERS_KEY, OWNER_DOMAINS, type OwnerDomain } from '@/lib/insight-owners';
import { ownerBindings } from '@/lib/settings';
import { canonicalEmail } from '@/lib/roles';
import { TAGS, invalidate } from '@/lib/cache';

// §5.2's map, the half that is a fact about the team rather than about the rules. D7: all
// but four rules produced findings with no owner, and the manual's own map names people
// who hold no account here — so the desks live in code and who sits at them lives here.

const DOMAINS = Object.keys(OWNER_DOMAINS) as OwnerDomain[];

const Input = z.object({
  domain: z.enum(DOMAINS as [OwnerDomain, ...OwnerDomain[]]),
  // Empty clears the binding, which is how a desk goes back to raising the configuration
  // finding rather than routing to somebody who has left.
  email: z.string().trim().max(200),
});

export const GET = route('settings:manage', async () => {
  return { owners: await ownerBindings() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(req, Input);

  const email = input.email ? canonicalEmail(input.email) : null;
  if (input.email && !email) {
    throw new Error(`Not a company address: ${input.email}`);
  }

  const before = await ownerBindings();
  const next = { ...before };
  if (email) next[input.domain] = email;
  else delete next[input.domain];

  await db().appSetting.upsert({
    where: { key: OWNERS_KEY },
    create: { key: OWNERS_KEY, value: next },
    update: { value: next },
  });

  await invalidate(TAGS.settings);
  await invalidate(TAGS.metrics);

  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.insight_owner',
      entityType: 'app_setting',
      entityId: input.domain,
      detail: {
        domain: OWNER_DOMAINS[input.domain],
        from: before[input.domain] ?? null,
        to: email,
      },
    },
  });

  return { domain: input.domain, email };
});
