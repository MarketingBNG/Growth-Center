import { db } from './prisma.ts';
import { canonicalEmail } from './roles.ts';
import {
  STATUS_LABELS,
  canTransition,
  isInsightStatus,
  requirementFor,
  type InsightStatus,
} from './insight-lifecycle.ts';

// Writing a finding's state. The machine itself lives in lib/insight-lifecycle.ts, which
// is pure and safe to import from a client component; everything here needs a database.

export class TransitionError extends Error {}

/**
 * The addresses a finding may be assigned to.
 *
 * Both the people with accounts here and the people who own records in the CRM. Only
 * three accounts exist, and none of them is a person who would act on a paid-media
 * finding; the sales and marketing team appear in this workspace only as `ownerEmail` on
 * the records they hold. Offering the accounts alone would make the field unusable, and
 * accepting any string would let a typo become an unfindable owner.
 */
export async function assignableOwners(): Promise<{ email: string; name: string | null }[]> {
  const [users, leadOwners, dealOwners] = await Promise.all([
    db().appUser.findMany({
      where: { active: true },
      select: { email: true, name: true },
    }),
    db().lead.groupBy({ by: ['ownerEmail'], where: { ownerEmail: { not: null } } }),
    db().opportunity.groupBy({ by: ['ownerEmail'], where: { ownerEmail: { not: null } } }),
  ]);

  const byEmail = new Map<string, string | null>();
  for (const u of users) byEmail.set(u.email, u.name);
  for (const row of [...leadOwners, ...dealOwners]) {
    if (row.ownerEmail && !byEmail.has(row.ownerEmail)) byEmail.set(row.ownerEmail, null);
  }

  return [...byEmail]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export type StatusChange = {
  to: InsightStatus;
  ownerEmail?: string | null;
  reviewNote?: string | null;
};

/**
 * Moves a finding, writing every field that state implies in one place.
 *
 * `status` and `dismissedAt` are set together and only here. Two columns that can
 * disagree about whether something is dismissed is the failure this codebase has already
 * been bitten by — and both are read by pages that would then contradict each other.
 */
export async function setInsightStatus(
  id: string,
  change: StatusChange,
  actorEmail: string,
): Promise<{ id: string; status: InsightStatus } | null> {
  const insight = await db().aiInsight.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, ownerEmail: true, provider: true },
  });
  if (!insight) return null;

  const from = isInsightStatus(insight.status) ? insight.status : 'proposed';
  if (from === change.to) throw new TransitionError(`Already ${STATUS_LABELS[from].toLowerCase()}.`);
  if (!canTransition(from, change.to)) {
    throw new TransitionError(
      `A ${STATUS_LABELS[from].toLowerCase()} finding cannot go straight to ${STATUS_LABELS[change.to].toLowerCase()}.`,
    );
  }

  // An owner already on the record satisfies a re-assignment, so moving a finding through
  // in_progress and back does not demand the same address be re-entered each time.
  const ownerEmail = change.ownerEmail ? canonicalEmail(change.ownerEmail) : insight.ownerEmail;
  if (change.ownerEmail && !ownerEmail) {
    throw new TransitionError(`Not a valid company address: ${change.ownerEmail}`);
  }

  const problem = requirementFor(change.to, { ownerEmail, reviewNote: change.reviewNote });
  if (problem) throw new TransitionError(problem);

  const now = new Date();
  await db().aiInsight.update({
    where: { id },
    data: {
      status: change.to,
      ownerEmail,
      // Kept rather than overwritten with null when a transition carries no note: the
      // reason a finding was dismissed in March is still the reason it was dismissed,
      // and blanking it on reopen would lose the only record of the judgement.
      reviewNote: change.reviewNote?.trim() || undefined,
      reviewedByEmail: actorEmail,
      reviewedAt: now,
      dismissedAt: change.to === 'dismissed' ? now : null,
    },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'insight.status',
      entityType: 'ai_insight',
      entityId: id,
      detail: {
        title: insight.title,
        from,
        to: change.to,
        ...(ownerEmail ? { owner: ownerEmail } : {}),
        ...(change.reviewNote?.trim() ? { note: change.reviewNote.trim() } : {}),
      },
    },
  });

  return { id, status: change.to };
}
