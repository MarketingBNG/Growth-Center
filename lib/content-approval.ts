import { createHash } from 'node:crypto';

// What an approval on a content piece is, and when it stops being one.
//
// §21.2: "Approve records her identity, the time and the exact card version she saw.
// Return quotes the finding back to the author and keeps the SLA clock running."
//
// Pure, so the rules are testable without a database and importable from a client
// component. The writes are in lib/content.ts.
//
// ── Why an approval is bound to a hash ────────────────────────────────────────────────
//
// An approval recording only who and when says "this person approved this piece", and
// that sentence stops being true the moment somebody edits the piece. Nothing in the
// record would show it: the name and the timestamp still sit there, now vouching for
// words the approver never read. The sequence registry hit this first and solved it the
// same way — the approval carries a hash of what was approved, and an approval whose hash
// no longer matches is reported as stale rather than allowed to stand.
//
// This is the whole reason `approve` was made a real permission and given to the owner
// alone: an approval that silently covers later edits is worse than no approval at all,
// because people rely on it.

/** The fields an approver is actually judging. */
export type Approvable = {
  title: string;
  brief: string | null;
  url: string | null;
  format: string;
  channelSlug: string | null;
};

/**
 * A hash of what was approved.
 *
 * Covers the fields a reviewer reads and decides on — not `views`, not `leadsGenerated`,
 * not `updatedAt`, which move on their own and would expire every approval within a day.
 * Fields are joined with a separator that cannot appear in a field name, so moving text
 * from the title into the brief changes the hash.
 */
export function contentHash(piece: Approvable): string {
  const parts = [piece.title, piece.brief ?? '', piece.url ?? '', piece.format, piece.channelSlug ?? ''];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export type ApprovalState =
  | { state: 'unapproved' }
  | { state: 'returned'; at: Date; note: string | null }
  | { state: 'approved'; by: string; at: Date }
  | { state: 'stale'; by: string; at: Date };

export type ApprovalRecord = {
  approvedByEmail: string | null;
  approvedAt: Date | null;
  approvedHash: string | null;
  returnedAt: Date | null;
  returnedNote: string | null;
};

/**
 * Where a piece stands, derived rather than stored.
 *
 * Derived because the answer depends on the current content: the same stored approval is
 * valid before an edit and stale after one, and a stored `isApproved` column would have
 * to be found and cleared by whatever does the editing. It would eventually be missed.
 */
export function approvalState(piece: Approvable & ApprovalRecord): ApprovalState {
  if (piece.approvedByEmail && piece.approvedAt) {
    const matches = piece.approvedHash === contentHash(piece);
    return matches
      ? { state: 'approved', by: piece.approvedByEmail, at: piece.approvedAt }
      : { state: 'stale', by: piece.approvedByEmail, at: piece.approvedAt };
  }
  if (piece.returnedAt) {
    return { state: 'returned', at: piece.returnedAt, note: piece.returnedNote };
  }
  return { state: 'unapproved' };
}

export const APPROVAL_LABELS: Record<ApprovalState['state'], string> = {
  unapproved: 'Not approved',
  returned: 'Returned to author',
  approved: 'Approved',
  // Named for what a reader has to do about it, not for the mechanism. "Hash mismatch"
  // is true and tells nobody that the piece needs approving again.
  stale: 'Edited since approval',
};

/**
 * Whether a piece may be published.
 *
 * The one gate that matters, and it is deliberately strict about the stale case: a piece
 * edited after approval is not approved, and letting it publish would make every
 * approval in the system mean "somebody approved an earlier draft of this".
 */
export function canPublish(state: ApprovalState): boolean {
  return state.state === 'approved';
}

/**
 * How long a piece has been in review, in hours, however many times it has been returned.
 *
 * §21.2: a return "keeps the SLA clock running". Measured from `reviewStartedAt` and not
 * reset by a return — otherwise bouncing a piece back to its author would make a
 * fortnight-old item look like it arrived this morning, which is the one thing an SLA
 * clock exists to prevent.
 */
export function reviewAgeHours(
  reviewStartedAt: Date | null | undefined,
  now: Date,
): number | null {
  if (!reviewStartedAt) return null;
  return Math.max(0, (now.getTime() - reviewStartedAt.getTime()) / 3_600_000);
}
