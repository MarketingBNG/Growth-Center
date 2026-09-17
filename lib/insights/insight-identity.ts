import { createHash } from 'node:crypto';
import type { InsightKind } from '../shared/enums.ts';

// What makes two findings, written on different days by different runs, the same finding.
//
// The previous behaviour was to delete every generated row and write a new set. That is
// defensible for the text — a finding describes the numbers as they were — but it throws
// away the only thing the page cannot recompute: how long this has been true. A ROAS
// problem in its fourth month arrived on screen looking discovered this morning, and a
// dismissal lasted until the next run, which is to say it did not exist.
//
// ── Why identity cannot come from the text ────────────────────────────────────────────
//
// The obvious fingerprint is a hash of the title and body, and it is wrong. The model
// rewords the same finding every run and the figures inside it move, so a text hash makes
// every finding new every time — the exact behaviour being fixed, reimplemented at more
// expense. Identity has to be about the SUBJECT: the thing in the business the finding
// concerns, which persists while the sentence describing it changes.
//
// Nothing in the data supplies that subject, so the model is asked for it, and — this is
// the part that makes it work — it is given the subjects already open and told to reuse
// one where the finding is the same issue. Recognition is then mostly a matching problem
// against a short list, not free invention.
//
// ── Where this is deliberately loose ──────────────────────────────────────────────────
//
// The model can still coin a new subject for something it raised last month under another
// name, and the app will show it as new. That is a miss, not a corruption: the worst case
// is a finding that looks younger than it is, which is the state everything was in before
// this existed. The alternative — matching findings by similarity — would sometimes merge
// two genuinely different problems into one row and silently lose the second, which is a
// worse failure and a much harder one to notice.

/**
 * Normalises a model-supplied subject to something usable as an identity.
 *
 * Lowercased, non-alphanumerics collapsed to single hyphens, trimmed to 80 characters.
 * The model is asked for a slug and mostly returns one, but "ROAS below 1.0" and
 * "roas-below-1-0" must not be two findings, and a run that returns a whole sentence must
 * not produce a subject nothing will ever match again.
 *
 * Returns null for anything that normalises to nothing, so a blank subject fails to
 * produce a fingerprint rather than producing one every empty subject shares.
 */
export function normaliseSubject(raw: string | null | undefined): string | null {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || null;
}

/**
 * The identity of a finding: its kind and its subject, hashed.
 *
 * Kind is included because the same subject can be raised as a risk and as an
 * opportunity, and those are different findings about one thing rather than one finding.
 * Hashed rather than stored as the pair so the unique index is over a single fixed-width
 * column, and so a subject containing anything unexpected cannot break the key.
 */
export function fingerprint(kind: InsightKind, subject: string | null): string | null {
  const slug = normaliseSubject(subject);
  if (!slug) return null;
  return createHash('sha256').update(`${kind}\u0000${slug}`).digest('hex');
}

/** How long a finding has been open, in whole days. Null when it has never been seen. */
export function ageInDays(firstSeenAt: Date | null | undefined, now: Date): number | null {
  if (!firstSeenAt) return null;
  return Math.max(0, Math.floor((now.getTime() - firstSeenAt.getTime()) / 86_400_000));
}

/**
 * "Raised today", "Open 12 days" — what the page prints beside a finding.
 *
 * Says nothing at all where there is no history, rather than guessing "new": rows written
 * before identity existed have no first-seen date, and calling those new would be the
 * claim this whole module was built to stop making.
 */
export function ageLabel(firstSeenAt: Date | null | undefined, now: Date): string | null {
  const days = ageInDays(firstSeenAt, now);
  if (days === null) return null;
  if (days === 0) return 'Raised today';
  if (days === 1) return 'Open since yesterday';
  return `Open ${days} days`;
}

/**
 * Which stored findings a run has just confirmed, and which it has stopped reporting.
 *
 * Pure, so the decision to resolve a finding is testable without a database and without a
 * model. `seen` is the set of fingerprints this run produced.
 *
 * Only rows that carry a fingerprint can be resolved. A row without one was written
 * before identity existed, or by a run whose model gave no usable subject; there is no
 * way to tell whether this run reported it, and stamping it resolved would be asserting
 * something unknown.
 */
export function toResolve<T extends { id: string; fingerprint: string | null; resolvedAt: Date | null }>(
  stored: T[],
  seen: Set<string>,
): string[] {
  return stored
    .filter((row) => row.fingerprint && !row.resolvedAt && !seen.has(row.fingerprint))
    .map((row) => row.id);
}
