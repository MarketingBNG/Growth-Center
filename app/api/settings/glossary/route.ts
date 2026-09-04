import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { GLOSSARY, GLOSSARY_SLUGS, isGlossarySlug } from '@/lib/glossary';
import { glossaryOwners, saveGlossaryOwner } from '@/lib/settings';
import { TAGS, invalidate } from '@/lib/cache';

// Appendix C's third column: who owns each definition.
//
// Reading is open to anyone who can read the app — a definition nobody can look up is a
// definition people guess at, which is the whole problem the appendix exists to solve.
// Changing an owner is behind settings:manage.

export const GET = route('growth:read', async () => {
  return { owners: await glossaryOwners() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({
      slug: z.enum(GLOSSARY_SLUGS as [string, ...string[]]),
      // Empty clears the override and the default takes over again. Nullable rather than
      // optional, so clearing is something the client says rather than something it omits.
      owner: z.string().max(80).nullable(),
    }),
  );
  if (!isGlossarySlug(input.slug)) throw new Error(`Not a glossary term: ${input.slug}`);

  const term = GLOSSARY.find((t) => t.slug === input.slug)!;
  const before = (await glossaryOwners())[input.slug] ?? term.defaultOwner;
  const owner = await saveGlossaryOwner(input.slug, input.owner);

  await invalidate(TAGS.settings);

  // Recorded for the same reason a threshold change is: the owner of a definition is who
  // gets asked when two reports disagree, and a quiet reassignment leaves the question
  // pointed at somebody who never agreed to answer it.
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.glossary',
      entityType: 'app_setting',
      entityId: input.slug,
      detail: { name: term.term, from: before, to: owner ?? `${term.defaultOwner} (default)` },
    },
  });

  return { slug: input.slug, owner: owner ?? term.defaultOwner, isDefault: owner === null };
});
