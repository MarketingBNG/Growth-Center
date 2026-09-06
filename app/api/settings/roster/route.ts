import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { ROSTER_KEY, marketingRoster } from '@/lib/roster';
import { canonicalEmail } from '@/lib/roles';
import { TAGS, invalidate } from '@/lib/cache';

// Who the Growth Center's queue is for. D2: the task-debt rule was raising a finding per
// person across the whole firm, eighteen of them, of whom one was on the marketing team.
//
// Saved whole rather than one address at a time. A roster is a list somebody edits as a
// list — adding two people and removing one is a single thought — and a per-member route
// would need its own reconciliation of what the list used to be.

const Input = z.object({
  emails: z.array(z.string()).max(100),
});

export const GET = route('settings:manage', async () => {
  return { emails: await marketingRoster() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(req, Input);

  // Canonicalised here as well as on read, so what is stored is what will match. An
  // address outside the firm's domains belongs to somebody who cannot sign in, and it is
  // reported rather than dropped silently — a name vanishing from a list the person just
  // saved looks like the save failed.
  const rejected: string[] = [];
  const emails: string[] = [];
  for (const raw of input.emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const canonical = canonicalEmail(trimmed);
    if (canonical) emails.push(canonical);
    else rejected.push(trimmed);
  }
  const unique = [...new Set(emails)].sort();

  const before = await marketingRoster();

  await db().appSetting.upsert({
    where: { key: ROSTER_KEY },
    create: { key: ROSTER_KEY, value: unique },
    update: { value: unique },
  });

  // Both tags: the roster is a setting, and the rules that read it are computed under
  // metrics.
  await invalidate(TAGS.settings);
  await invalidate(TAGS.metrics);

  // Recorded for the same reason a threshold change is: removing somebody from the roster
  // is how their overdue work stops appearing, and a quiet queue should be explainable.
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.roster',
      entityType: 'app_setting',
      entityId: ROSTER_KEY,
      detail: { from: before, to: unique },
    },
  });

  return { emails: unique, rejected };
});
