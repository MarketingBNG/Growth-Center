import { db } from './prisma.ts';
import { findCandidates, RULE_LABELS, type Candidate, type MatchRule } from './duplicates.ts';
import { isMachineAddress } from './dedupe.ts';

// The database half of §8.1: scanning for candidates, and acting on one.
//
// lib/duplicates.ts holds the rules and is pure. This holds the queries, the writes and
// the merge — which is the part that can destroy data, and is therefore the part with the
// ordering argument in it.

/**
 * How far back a scan looks.
 *
 * Not the whole book. 27,575 leads pairwise is a number no scheduled job should attempt,
 * and a duplicate that has sat unnoticed since last November is not the one anybody is
 * about to act on. The recent window is where a duplicate is still cheap to fix — before
 * two people have both worked the record.
 */
const SCAN_DAYS = 180;

/**
 * How many candidates one scan may add.
 *
 * A queue nobody can finish is a queue nobody starts. If a scan finds more than this, the
 * strongest are kept and the rest wait for the next run — by which time the strongest
 * will have been resolved.
 */
const MAX_PER_SCAN = 200;

export type ScanResult = {
  scanned: Record<string, number>;
  found: number;
  added: number;
  /** Already in the queue, resolved or pending. Reported so a scan that finds nothing new
   *  reads as "nothing new" rather than as a scanner that has stopped working. */
  alreadyKnown: number;
};

/**
 * Looks for duplicates and files what it finds. Merges nothing.
 *
 * Idempotent by construction: the unique index on (entityType, primaryId, duplicateId)
 * plus `skipDuplicates` means a second scan over unchanged data adds nothing, and a pair
 * a person has already dismissed is never re-proposed.
 */
export async function scanDuplicates(now = new Date()): Promise<ScanResult> {
  const since = new Date(now.getTime() - SCAN_DAYS * 86_400_000);

  const [leads, companies, contacts] = await Promise.all([
    db().lead.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        email: true,
        phone: true,
        companyName: true,
        createdAt: true,
        // Richness, for chooseSurvivor. A merge that keeps the empty stub and discards
        // the deals and the activity log is the one outcome this must never produce.
        _count: { select: { opportunities: true, activities: true, noteEntries: true } },
      },
    }),
    db().company.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        name: true,
        domain: true,
        phone: true,
        createdAt: true,
        _count: { select: { opportunities: true, contacts: true, activities: true } },
      },
    }),
    db().contact.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        _count: { select: { opportunities: true, activities: true } },
      },
    }),
  ]);

  const weigh = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  // Machine addresses are excluded from *proposals*, never from the data. A Zoho
  // notification contact is a real row with real activity hanging off it; it simply is
  // not a person who can be a duplicate of another person.
  //
  // Not a nicety. The first live scan filled all 200 queue slots with pairs of Zoho
  // Campaigns bounce addresses — VERP local parts where the `+` tag is the identity, so
  // normalizeEmail collapsed twenty-four distinct senders onto one — and pushed every
  // genuine duplicate off the page.
  const human = <T extends { email?: string | null }>(rows: T[]) =>
    rows.filter((r) => !isMachineAddress(r.email));

  const candidates = [
    ...findCandidates(
      'lead',
      human(leads).map((l) => ({
        id: l.id,
        email: l.email,
        phone: l.phone,
        name: l.companyName,
        createdAt: l.createdAt,
        weight: weigh(l._count),
      })),
    ),
    ...findCandidates(
      'company',
      companies.map((c) => ({
        id: c.id,
        // A company's domain is its identity here, and it is already unique — so the
        // domain rule can never fire on this table. Passed as the email anyway so the
        // rule is applied uniformly rather than special-cased into silence.
        email: c.domain ? `x@${c.domain}` : null,
        phone: c.phone,
        name: c.name,
        createdAt: c.createdAt,
        weight: weigh(c._count),
      })),
    ),
    ...findCandidates(
      'contact',
      human(contacts).map((c) => ({
        id: c.id,
        email: c.email,
        phone: c.phone,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
        createdAt: c.createdAt,
        weight: weigh(c._count),
      })),
    ),
  ].sort((a, b) => b.confidence - a.confidence);

  const keep = candidates.slice(0, MAX_PER_SCAN);

  const before = await db().duplicateCandidate.count();
  if (keep.length > 0) {
    await db().duplicateCandidate.createMany({
      data: keep.map((c) => ({
        entityType: c.entityType,
        primaryId: c.primaryId,
        duplicateId: c.duplicateId,
        rule: c.rule,
        confidence: c.confidence,
        matchedOn: c.matchedOn,
      })),
      // The whole idempotency story. A pair already in the queue — pending, merged or
      // dismissed — is left exactly as it is, so a scan never reopens a decision.
      skipDuplicates: true,
    });
  }
  const after = await db().duplicateCandidate.count();

  return {
    scanned: { lead: leads.length, company: companies.length, contact: contacts.length },
    found: candidates.length,
    added: after - before,
    alreadyKnown: keep.length - (after - before),
  };
}

export type QueueRow = {
  id: string;
  entityType: string;
  rule: MatchRule;
  ruleLabel: string;
  confidence: number;
  matchedOn: string;
  detectedAt: Date;
  primary: { id: string; label: string; detail: string; weight: number } | null;
  duplicate: { id: string; label: string; detail: string; weight: number } | null;
};

/**
 * The pending queue, strongest first, with both records resolved for display.
 *
 * A pair whose records no longer exist — one of them merged away by hand in Zoho — comes
 * back with nulls rather than being dropped. The page renders it as stale and offers to
 * dismiss it, because a row that silently vanishes teaches nobody that the queue is
 * keeping up.
 */
export async function duplicateQueue(take = 50): Promise<QueueRow[]> {
  const rows = await db().duplicateCandidate.findMany({
    where: { status: 'pending' },
    orderBy: [{ confidence: 'desc' }, { detectedAt: 'desc' }],
    take,
  });
  if (rows.length === 0) return [];

  const ids = (type: string) =>
    rows.filter((r) => r.entityType === type).flatMap((r) => [r.primaryId, r.duplicateId]);

  const [leads, companies, contacts] = await Promise.all([
    db().lead.findMany({
      where: { id: { in: ids('lead') } },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, companyName: true,
        _count: { select: { opportunities: true, activities: true, noteEntries: true } },
      },
    }),
    db().company.findMany({
      where: { id: { in: ids('company') } },
      select: {
        id: true, name: true, domain: true, phone: true,
        _count: { select: { opportunities: true, contacts: true, activities: true } },
      },
    }),
    db().contact.findMany({
      where: { id: { in: ids('contact') } },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        _count: { select: { opportunities: true, activities: true } },
      },
    }),
  ]);

  const weigh = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
  const index = new Map<string, { id: string; label: string; detail: string; weight: number }>();

  for (const l of leads) {
    index.set(`lead:${l.id}`, {
      id: l.id,
      label: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed lead',
      detail: [l.email, l.phone, l.companyName].filter(Boolean).join(' · ') || 'No contact details',
      weight: weigh(l._count),
    });
  }
  for (const c of companies) {
    index.set(`company:${c.id}`, {
      id: c.id,
      label: c.name,
      detail: [c.domain, c.phone].filter(Boolean).join(' · ') || 'No domain or phone',
      weight: weigh(c._count),
    });
  }
  for (const c of contacts) {
    index.set(`contact:${c.id}`, {
      id: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed contact',
      detail: [c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details',
      weight: weigh(c._count),
    });
  }

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    rule: r.rule as MatchRule,
    ruleLabel: RULE_LABELS[r.rule as MatchRule] ?? r.rule,
    confidence: r.confidence,
    matchedOn: r.matchedOn,
    detectedAt: r.detectedAt,
    primary: index.get(`${r.entityType}:${r.primaryId}`) ?? null,
    duplicate: index.get(`${r.entityType}:${r.duplicateId}`) ?? null,
  }));
}

export class MergeError extends Error {}

/**
 * Folds one record into another, then deletes it.
 *
 * The ordering is the whole of the safety argument. Every child row is re-pointed at the
 * survivor **before** the duplicate is deleted, inside one transaction: reversed, a
 * failure halfway would leave the deals of a deleted lead pointing at nothing, and
 * `onDelete: SetNull` would have quietly severed them rather than failing loudly.
 *
 * Only leads and contacts merge. A company merge would have to move contacts, deals,
 * activities, notes, tasks, a Customer row and its revenue — and `Customer.companyId` is
 * unique, so two customers cannot become one without deciding which won date and which
 * revenue history survives. That is a business decision, not a data operation, and
 * guessing it would corrupt the revenue figures this feature exists to protect.
 */
/** What `mergeDuplicate` writes down so the merge can be taken back. */
type MergeUndo = {
  /** Every scalar of the record that was deleted, including its id. */
  record: Record<string, unknown>;
  /** Only the children that actually moved, by id. */
  moved: {
    opportunities: string[];
    activities: string[];
    notes: string[];
    tasks: string[];
    leads: string[];
  };
};

/**
 * How long a merge stays reversible.
 *
 * Short on purpose. Undo here is for the click that was wrong — the wrong row, the wrong
 * pair, a hand that moved before the eye read — and that is noticed in seconds. It is not
 * a general history: an hour later somebody may have edited the surviving record, and
 * putting the other one back would then be inventing a state that never existed. Past the
 * window the answer is a restore from Zoho, which is the system of record.
 */
export const UNDO_WINDOW_MINUTES = 15;

export async function mergeDuplicate(candidateId: string, actorEmail: string) {
  const candidate = await db().duplicateCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new MergeError('That candidate no longer exists.');
  if (candidate.status !== 'pending') {
    throw new MergeError(`This pair was already ${candidate.status}.`);
  }
  if (candidate.entityType === 'company') {
    throw new MergeError(
      'Company merges are not automated. A company carries a Customer row and its revenue history, and deciding which won date and which revenue survives is a business decision rather than a data operation.',
    );
  }

  const { entityType, primaryId, duplicateId } = candidate;

  /** What it would take to put this back. See `unmergeDuplicate`. */
  let undo: MergeUndo | null = null;

  await db().$transaction(async (tx) => {
    // Children first, in one transaction. See the note above: reversed, a failure halfway
    // through severs a deleted record's deals instead of failing.
    if (entityType === 'lead') {
      // Read before writing. The record is about to be deleted and the children about to
      // be reparented, so this is the only moment either can be described — and the ids
      // have to be the ones that actually moved, not everything hanging off the primary
      // afterwards, or an undo would drag across rows that were always the primary's.
      const record = await tx.lead.findUnique({ where: { id: duplicateId } });
      const [opportunities, activities, notes, tasks] = await Promise.all([
        tx.opportunity.findMany({ where: { leadId: duplicateId }, select: { id: true } }),
        tx.activity.findMany({ where: { leadId: duplicateId }, select: { id: true } }),
        tx.note.findMany({ where: { leadId: duplicateId }, select: { id: true } }),
        tx.task.findMany({ where: { leadId: duplicateId }, select: { id: true } }),
      ]);
      undo = {
        record: record as Record<string, unknown>,
        moved: {
          opportunities: opportunities.map((r) => r.id),
          activities: activities.map((r) => r.id),
          notes: notes.map((r) => r.id),
          tasks: tasks.map((r) => r.id),
          leads: [],
        },
      };

      await tx.opportunity.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
      await tx.activity.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
      await tx.note.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
      await tx.task.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
      await tx.lead.delete({ where: { id: duplicateId } });
    } else {
      const record = await tx.contact.findUnique({ where: { id: duplicateId } });
      const [opportunities, activities, notes, tasks, leads] = await Promise.all([
        tx.opportunity.findMany({ where: { contactId: duplicateId }, select: { id: true } }),
        tx.activity.findMany({ where: { contactId: duplicateId }, select: { id: true } }),
        tx.note.findMany({ where: { contactId: duplicateId }, select: { id: true } }),
        tx.task.findMany({ where: { contactId: duplicateId }, select: { id: true } }),
        tx.lead.findMany({ where: { contactId: duplicateId }, select: { id: true } }),
      ]);
      undo = {
        record: record as Record<string, unknown>,
        moved: {
          opportunities: opportunities.map((r) => r.id),
          activities: activities.map((r) => r.id),
          notes: notes.map((r) => r.id),
          tasks: tasks.map((r) => r.id),
          leads: leads.map((r) => r.id),
        },
      };

      await tx.opportunity.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
      await tx.activity.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
      await tx.note.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
      await tx.task.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
      await tx.lead.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
      await tx.contact.delete({ where: { id: duplicateId } });
    }

    await tx.duplicateCandidate.update({
      where: { id: candidateId },
      data: { status: 'merged', resolvedAt: new Date(), resolvedBy: actorEmail },
    });

    // Any other pending pair naming the record that has just gone. Left alone they would
    // sit in the queue offering to merge something that no longer exists.
    await tx.duplicateCandidate.updateMany({
      where: {
        status: 'pending',
        entityType,
        OR: [{ primaryId: duplicateId }, { duplicateId }],
      },
      data: {
        status: 'dismissed',
        resolvedAt: new Date(),
        resolvedBy: actorEmail,
        dismissReason: 'The other record in this pair was merged away.',
      },
    });
  });

  // Outside the transaction: a merge that succeeded must not be rolled back because the
  // audit row failed to write, and G6 wants the record of who did it either way.
  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'duplicate.merged',
      entityType,
      entityId: primaryId,
      detail: {
        merged: duplicateId,
        into: primaryId,
        rule: candidate.rule,
        matchedOn: candidate.matchedOn,
        candidateId,
        // The deleted record and the rows that moved, so the merge can be reversed. It
        // lives on the audit row rather than in a table of its own because the audit row
        // is already the thing that says this merge happened, and a snapshot that could
        // drift out of step with it would be worse than none.
        undo,
      },
    },
  });

  return { primaryId, duplicateId, entityType };
}

/**
 * Puts a merged pair back.
 *
 * A merge deletes a record, which is the one thing on this screen that cannot be undone
 * by doing the opposite — so the merge writes down what it destroyed and this reads it
 * back. The record is recreated with its original id, and only the children that moved
 * are moved back, so a primary that always owned a deal keeps it.
 *
 * Three things make it refuse rather than guess: a pair that is not `merged`, a merge
 * older than the undo window, and a record whose id is somehow occupied again. In each
 * case the honest answer is that this is no longer a reversal, and pretending otherwise
 * would write a state that never existed.
 */
export async function unmergeDuplicate(candidateId: string, actorEmail: string) {
  const candidate = await db().duplicateCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new MergeError('That candidate no longer exists.');
  if (candidate.status !== 'merged') {
    throw new MergeError(`This pair is ${candidate.status}, so there is no merge to undo.`);
  }

  const since = new Date(Date.now() - UNDO_WINDOW_MINUTES * 60_000);
  const recent = await db().auditEvent.findMany({
    where: { action: 'duplicate.merged', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const event = recent.find(
    (e) => (e.detail as { candidateId?: string } | null)?.candidateId === candidateId,
  );
  if (!event) {
    throw new MergeError(
      `A merge can only be undone within ${UNDO_WINDOW_MINUTES} minutes of being made. Restore the record from Zoho instead — it is the system of record.`,
    );
  }

  const undo = (event.detail as { undo?: MergeUndo } | null)?.undo;
  if (!undo?.record) {
    throw new MergeError(
      'This merge was made before undo was recorded, so there is no snapshot to restore from.',
    );
  }

  const { entityType, primaryId, duplicateId } = candidate;

  await db().$transaction(async (tx) => {
    if (entityType === 'lead') {
      const taken = await tx.lead.findUnique({ where: { id: duplicateId }, select: { id: true } });
      if (taken) throw new MergeError('That record exists again, so this merge has already been undone.');
      await tx.lead.create({ data: undo.record as never });
      await tx.opportunity.updateMany({
        where: { id: { in: undo.moved.opportunities } },
        data: { leadId: duplicateId },
      });
      await tx.activity.updateMany({ where: { id: { in: undo.moved.activities } }, data: { leadId: duplicateId } });
      await tx.note.updateMany({ where: { id: { in: undo.moved.notes } }, data: { leadId: duplicateId } });
      await tx.task.updateMany({ where: { id: { in: undo.moved.tasks } }, data: { leadId: duplicateId } });
    } else {
      const taken = await tx.contact.findUnique({ where: { id: duplicateId }, select: { id: true } });
      if (taken) throw new MergeError('That record exists again, so this merge has already been undone.');
      await tx.contact.create({ data: undo.record as never });
      await tx.opportunity.updateMany({
        where: { id: { in: undo.moved.opportunities } },
        data: { contactId: duplicateId },
      });
      await tx.activity.updateMany({ where: { id: { in: undo.moved.activities } }, data: { contactId: duplicateId } });
      await tx.note.updateMany({ where: { id: { in: undo.moved.notes } }, data: { contactId: duplicateId } });
      await tx.task.updateMany({ where: { id: { in: undo.moved.tasks } }, data: { contactId: duplicateId } });
      await tx.lead.updateMany({ where: { id: { in: undo.moved.leads } }, data: { contactId: duplicateId } });
    }

    await tx.duplicateCandidate.update({
      where: { id: candidateId },
      data: { status: 'pending', resolvedAt: null, resolvedBy: null },
    });

    // The pairs the merge closed on the grounds that one side had gone. It has not gone
    // any more, so they are decisions waiting again rather than settled ones.
    await tx.duplicateCandidate.updateMany({
      where: {
        status: 'dismissed',
        entityType,
        dismissReason: 'The other record in this pair was merged away.',
        OR: [{ primaryId: duplicateId }, { duplicateId }],
      },
      data: { status: 'pending', resolvedAt: null, resolvedBy: null, dismissReason: null },
    });
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'duplicate.merge_undone',
      entityType,
      entityId: primaryId,
      detail: { restored: duplicateId, from: primaryId, candidateId, mergedAt: event.createdAt },
    },
  });

  return { restored: duplicateId, primaryId, entityType };
}

/**
 * Rejects a pair, with a reason.
 *
 * The reason is required, for the same argument §20.2 makes about dismissing a finding: a
 * dismissal with no note is indistinguishable from somebody clearing their screen, and it
 * is what stops the next scan from proposing the same pair for ever.
 */
export async function dismissDuplicate(candidateId: string, reason: string, actorEmail: string) {
  const note = reason.trim();
  if (!note) throw new MergeError('Say why these are not the same record.');

  const updated = await db().duplicateCandidate.updateMany({
    where: { id: candidateId, status: 'pending' },
    data: { status: 'dismissed', resolvedAt: new Date(), resolvedBy: actorEmail, dismissReason: note },
  });
  if (updated.count === 0) throw new MergeError('That pair has already been resolved.');

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'duplicate.dismissed',
      entityType: 'duplicate_candidate',
      entityId: candidateId,
      detail: { reason: note },
    },
  });
}

/** Counts for the CRM card, so it can stop saying zero. */
export async function duplicateCounts(range?: { from: Date; to: Date }) {
  const [pending, merged, dismissed] = await Promise.all([
    db().duplicateCandidate.count({ where: { status: 'pending' } }),
    db().duplicateCandidate.count({
      where: { status: 'merged', ...(range ? { resolvedAt: { gte: range.from, lte: range.to } } : {}) },
    }),
    db().duplicateCandidate.count({ where: { status: 'dismissed' } }),
  ]);
  return { pending, merged, dismissed };
}

export type { Candidate };
