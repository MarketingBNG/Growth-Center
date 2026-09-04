// The insight lifecycle: the states, and what may follow what.
//
// Pure, and importable from a client component. Kept apart from lib/insight-actions.ts
// for the same reason lib/kpi.ts is kept apart from lib/metrics.ts: that file touches the
// database, so a value import of it from a client component follows the chain into the
// `pg` driver and breaks the build — which is exactly what happened when the buttons on
// /ai first read their labels from there.

// §20.1: "Every insight becomes an action item with an owner, or it is dismissed with a
// written reason. No orphan commentary." Both halves matter, and the second is the one
// that is easy to skip: a page of findings nobody has ruled on looks identical to a page
// whose findings were all considered and closed. The difference is the review note.

export const INSIGHT_STATUSES = [
  'proposed',
  'reviewed',
  'assigned',
  'in_progress',
  'done',
  'dismissed',
] as const;

export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export const STATUS_LABELS: Record<InsightStatus, string> = {
  proposed: 'Proposed',
  reviewed: 'Reviewed',
  assigned: 'Assigned',
  in_progress: 'In progress',
  done: 'Done',
  dismissed: 'Dismissed',
};

/**
 * Where each state can go next.
 *
 * Ordered, but not a one-way street: work comes back from `in_progress` when it turns out
 * to be somebody else's, and a dismissal is reopenable — a judgement made in March about
 * a figure that has since doubled deserves revisiting, and a decision with no way back is
 * one people avoid making.
 *
 * `done` is the one terminal state, reopenable only to `assigned`. Nothing may jump
 * straight from `proposed` to `done`: closing a finding without ever owning it is how a
 * queue gets cleared without the work happening, and §20.1's closure rate would then
 * measure tidying rather than progress.
 */
const TRANSITIONS: Record<InsightStatus, InsightStatus[]> = {
  proposed: ['reviewed', 'dismissed'],
  reviewed: ['assigned', 'dismissed', 'proposed'],
  assigned: ['in_progress', 'done', 'dismissed', 'reviewed'],
  in_progress: ['done', 'assigned', 'dismissed'],
  done: ['assigned'],
  dismissed: ['proposed'],
};

export function isInsightStatus(value: unknown): value is InsightStatus {
  return typeof value === 'string' && (INSIGHT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: InsightStatus, to: InsightStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: InsightStatus): InsightStatus[] {
  return TRANSITIONS[from];
}

/** States that mean "somebody is meant to be doing this", so the page can count open work
 *  without listing the states by hand at every call site. */
export function isOpen(status: InsightStatus): boolean {
  return status !== 'done' && status !== 'dismissed';
}


/**
 * What a move to this state additionally requires.
 *
 * Assigning without an owner produces the orphan action §20.1 rules out — an item on a
 * list with nobody carrying it — and dismissing without a note produces the orphan
 * commentary. Both are refused rather than defaulted.
 */
export function requirementFor(
  to: InsightStatus,
  input: { ownerEmail?: string | null; reviewNote?: string | null },
): string | null {
  if (to === 'assigned' && !input.ownerEmail) {
    return 'Assigning needs an owner — somebody has to be carrying it.';
  }
  if (to === 'dismissed' && !input.reviewNote?.trim()) {
    return 'Dismissing needs a reason, so the next person can tell a judged finding from an ignored one.';
  }
  return null;
}
