/**
 * Reading and writing the verified facts register.
 *
 * The half of lib/content/facts.ts that touches the database. Split for the reason
 * lib/content-calendar/parse.ts gives: the gate itself is the rule everything defers to,
 * and it stays exercisable by bare node without a Prisma client behind it.
 */
import { db } from '../platform/prisma.ts';
import { recordAudit } from '../platform/audit.ts';
import { FACT_KEY_PATTERN, type FactLike } from './facts.ts';
import { JURISDICTIONS } from './facts-fields.ts';

// Not cached, deliberately. A reviewer clears a fact and expects the register to say so on
// the next render; lib/platform/settings.ts makes the same call for the same reason.

export class FactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactError';
  }
}

/**
 * Every fact the gate may consider, as the gate wants them.
 *
 * Retired facts are included deliberately. The gate has to be able to say "that key exists
 * but is retired" rather than "no such fact" — the first sends an author to the register
 * to find its replacement, the second sends them to ask whether they typed it wrongly.
 */
export async function factsForGate(): Promise<FactLike[]> {
  const rows = await db().verifiedFact.findMany({
    select: { key: true, value: true, status: true, numericValue: true },
  });
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    status: r.status,
    numericValue: r.numericValue === null ? null : Number(r.numericValue),
  }));
}

export type FactInput = {
  key: string;
  label: string;
  value: string;
  numericValue?: number | null;
  unit?: string | null;
  jurisdiction: string;
  authority?: string | null;
  sourceUrl: string;
  sourceExcerpt: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  notes?: string | null;
};

/**
 * Checks a fact is well formed before it is stored.
 *
 * Pulled out so the same rules run on create and on edit. The source pair is the one worth
 * arguing about: a URL without the quoted passage cannot be checked by anybody but the
 * person who entered it, which is exactly the situation this register exists to end. Both
 * are required at entry rather than at approval, because "I will add the quote later"
 * survives a review queue remarkably well.
 */
export function validateFact(input: FactInput): void {
  const key = input.key.trim().toUpperCase();
  if (!FACT_KEY_PATTERN.test(key)) {
    throw new FactError(
      'The key must be upper-case letters, digits and dashes, starting with a letter — e.g. US-FBAR-THRESHOLD.',
    );
  }
  if (!input.label.trim()) throw new FactError('Give the fact a label a reviewer will recognise.');
  if (!input.value.trim()) throw new FactError('Give the value exactly as it should read in an article.');
  if (!(JURISDICTIONS as readonly string[]).includes(input.jurisdiction)) {
    throw new FactError(`Jurisdiction must be one of: ${JURISDICTIONS.join(', ')}.`);
  }

  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw new FactError('The source must be a full URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FactError('The source must be an http or https URL.');
  }
  if (input.sourceExcerpt.trim().length < 20) {
    throw new FactError(
      'Quote the passage that says this, not a summary of it — at least a sentence. A citation nobody else can check is the thing this register exists to replace.',
    );
  }
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw new FactError('The end date is before the start date.');
  }
}

const normalise = (input: FactInput) => ({
  ...input,
  key: input.key.trim().toUpperCase(),
  label: input.label.trim(),
  value: input.value.trim(),
  sourceUrl: input.sourceUrl.trim(),
  sourceExcerpt: input.sourceExcerpt.trim(),
});

export async function createFact(input: FactInput, actorEmail: string) {
  validateFact(input);
  const data = normalise(input);

  const existing = await db().verifiedFact.findUnique({ where: { key: data.key } });
  if (existing) {
    throw new FactError(
      `${data.key} already exists. To change a value, supersede it rather than editing — articles published under the old one need it to go on saying what it said.`,
    );
  }

  const fact = await db().verifiedFact.create({
    data: { ...data, status: 'draft', createdBy: actorEmail },
  });
  await recordAudit({
    actorEmail,
    action: 'fact.create',
    entityType: 'verified_fact',
    entityId: fact.id,
    detail: { key: fact.key, value: fact.value, jurisdiction: fact.jurisdiction },
  });
  return fact;
}

/** Puts a draft up for review. Separate from creating it so a half-entered fact does not
 *  land in a reviewer's queue. */
export async function proposeFact(id: string, actorEmail: string) {
  const fact = await db().verifiedFact.findUnique({ where: { id } });
  if (!fact) throw new FactError('No such fact.');
  if (fact.status !== 'draft') throw new FactError(`${fact.key} is ${fact.status}, not a draft.`);

  const updated = await db().verifiedFact.update({ where: { id }, data: { status: 'proposed' } });
  await recordAudit({
    actorEmail,
    action: 'fact.propose',
    entityType: 'verified_fact',
    entityId: id,
    detail: { key: fact.key },
  });
  return updated;
}

/**
 * A reviewer's decision, with the reviewer recorded.
 *
 * `approve` is the permission the route checks, and the email stored here is the answer to
 * "who said this number is right" — §3.4 wants a person, not a flag. A refusal sends it
 * back to draft with the reason attached rather than deleting it: the work of finding the
 * source has been done and the next attempt starts from it.
 *
 * **Nobody clears their own fact.** The person who entered it cannot be the person who
 * approves it, which is the same principle the outreach sign-off already enforces.
 */
export async function reviewFact(
  id: string,
  decision: 'approve' | 'refuse',
  reviewerEmail: string,
  note?: string | null,
) {
  const fact = await db().verifiedFact.findUnique({ where: { id } });
  if (!fact) throw new FactError('No such fact.');
  if (fact.status !== 'proposed') {
    throw new FactError(`${fact.key} is ${fact.status}. Only a proposed fact can be reviewed.`);
  }
  if (fact.createdBy && fact.createdBy.toLowerCase() === reviewerEmail.toLowerCase()) {
    throw new FactError(
      'You entered this fact, so you cannot be the one who clears it. It needs a second pair of eyes.',
    );
  }
  if (decision === 'refuse' && !note?.trim()) {
    throw new FactError('Say why it was refused, or the next attempt repeats the mistake.');
  }

  const updated = await db().verifiedFact.update({
    where: { id },
    data: {
      status: decision === 'approve' ? 'approved' : 'draft',
      reviewerEmail,
      reviewedAt: new Date(),
      reviewNote: note?.trim() || null,
    },
  });
  await recordAudit({
    actorEmail: reviewerEmail,
    action: decision === 'approve' ? 'fact.approve' : 'fact.refuse',
    entityType: 'verified_fact',
    entityId: id,
    detail: { key: fact.key, value: fact.value, note: note?.trim() || null },
  });
  return updated;
}

/**
 * Replaces an approved fact with a new one.
 *
 * Never an edit. A rate changing does not make the old rate wrong — it makes it the rate
 * for its year, and an article published under it cited something true at the time. The
 * old row is retired and kept, the new one points back at it, and both remain readable.
 */
export async function supersedeFact(id: string, input: FactInput, actorEmail: string) {
  validateFact(input);
  const old = await db().verifiedFact.findUnique({ where: { id } });
  if (!old) throw new FactError('No such fact.');
  if (old.status === 'retired') throw new FactError(`${old.key} is already retired.`);

  const data = normalise(input);

  // The key is carried over, not re-entered. Drafts refer to facts by key, and a
  // superseding fact that changed it would silently orphan every article using it.
  const replacement = await db().$transaction(async (tx) => {
    await tx.verifiedFact.update({
      where: { id },
      // Freed first: `key` is unique, and the new row needs it.
      data: { status: 'retired', key: `${old.key}@${old.id.slice(0, 8)}` },
    });
    return tx.verifiedFact.create({
      data: {
        ...data,
        key: old.key,
        status: 'draft',
        createdBy: actorEmail,
        supersedesId: old.id,
      },
    });
  });

  await recordAudit({
    actorEmail,
    action: 'fact.supersede',
    entityType: 'verified_fact',
    entityId: replacement.id,
    detail: { key: old.key, was: old.value, now: replacement.value, retiredId: old.id },
  });
  return replacement;
}

/** The register, newest movement first, for the review centre. */
export async function listFacts() {
  return db().verifiedFact.findMany({
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      key: true,
      label: true,
      value: true,
      unit: true,
      jurisdiction: true,
      authority: true,
      sourceUrl: true,
      sourceExcerpt: true,
      status: true,
      reviewerEmail: true,
      reviewedAt: true,
      reviewNote: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdBy: true,
      createdAt: true,
      supersedesId: true,
    },
  });
}
