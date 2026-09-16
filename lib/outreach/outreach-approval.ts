// Whether a sequence is fit to send, and who said so.
//
// §14.2 of the Build and Operating Manual asks for the registry, and for the rule that a
// sequence without approval cannot display as active. This module is the second half: the
// state a sequence is in, derived rather than stored.
//
// Derived on purpose. `Sequence.status` comes from Smartlead and is overwritten on every
// sync, so an approval written into it would be gone by morning. Fitness is computed from
// the registry columns, the template hash and the linter each time it is read, which also
// means it cannot drift out of date the way a stored flag would.
//
// Framework-free: no Prisma, no React.

import { createHash } from 'node:crypto';
import { blocksSending, type LintFinding } from './outreach-lint.ts';

/** The four purposes in §14.2. `client_reminder` is the one the routing rule turns on. */
export const SEQUENCE_PURPOSES = [
  'cold_acquisition',
  'event_followup',
  'client_reminder',
  'dormant_revival',
] as const;

export type SequencePurpose = (typeof SEQUENCE_PURPOSES)[number];

export const PURPOSE_LABELS: Record<SequencePurpose, string> = {
  cold_acquisition: 'Cold acquisition',
  event_followup: 'Event follow-up',
  client_reminder: 'Client reminder',
  dormant_revival: 'Dormant revival',
};

export function purposeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return PURPOSE_LABELS[value as SequencePurpose] ?? value;
}

export type ApprovalColumns = {
  copyApprovedByEmail: string | null;
  copyApprovedAt: Date | null;
  copyApprovedHash: string | null;
  numbersVerifiedByEmail: string | null;
  numbersVerifiedAt: Date | null;
  numbersVerifiedHash: string | null;
};

export type HashableStep = { position: number; subject: string | null; body: string };

/**
 * A fingerprint of the template as it stands.
 *
 * Ordered by position and delimited with a character that cannot appear in the fields, so
 * moving text between the subject and the body changes the hash — two steps that
 * concatenate to the same string are not the same template.
 */
export function templateHash(steps: HashableStep[]): string {
  const canonical = [...steps]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.position}\u0000${s.subject ?? ''}\u0000${s.body ?? ''}`)
    .join('\u0001');
  return createHash('sha256').update(canonical).digest('hex');
}

export type SignOff =
  /** Nobody has signed this off. */
  | { state: 'none' }
  /** Signed off, and the template still says what it said then. */
  | { state: 'current'; byEmail: string; at: Date }
  /** Signed off, but the template has changed since. The tick does not carry over. */
  | { state: 'stale'; byEmail: string; at: Date };

function signOff(byEmail: string | null, at: Date | null, hash: string | null, current: string): SignOff {
  if (!byEmail || !at) return { state: 'none' };
  return hash === current ? { state: 'current', byEmail, at } : { state: 'stale', byEmail, at };
}

export type Fitness = {
  /** The linter's verdict — a placeholder or scaffolding token in the copy. */
  blocked: boolean;
  copy: SignOff;
  numbers: SignOff;
  /** Both sign-offs current, and nothing critical in the copy. */
  fitToSend: boolean;
  /** One line for the badge, written for whoever has to act on it. */
  summary: string;
};

/**
 * What state a sequence is in.
 *
 * Both sign-offs are required, not either: the manual separates them because they are
 * different competences — Shweta signs the copy and the brand, a CA or CPA verifies that
 * the statutory figures in it are right — and a template can easily be well written and
 * factually wrong.
 */
export function fitness(
  approvals: ApprovalColumns,
  steps: HashableStep[],
  findings: LintFinding[],
): Fitness {
  const current = templateHash(steps);
  const copy = signOff(
    approvals.copyApprovedByEmail,
    approvals.copyApprovedAt,
    approvals.copyApprovedHash,
    current,
  );
  const numbers = signOff(
    approvals.numbersVerifiedByEmail,
    approvals.numbersVerifiedAt,
    approvals.numbersVerifiedHash,
    current,
  );

  const blocked = blocksSending(findings);
  const fitToSend = !blocked && copy.state === 'current' && numbers.state === 'current';

  return { blocked, copy, numbers, fitToSend, summary: describe(blocked, copy, numbers) };
}

function describe(blocked: boolean, copy: SignOff, numbers: SignOff): string {
  // Ordered by what stops a send first. A template with a placeholder in it does not
  // become sendable by being approved, so the linter's verdict leads.
  if (blocked) return 'Not fit to send — the copy has unresolved placeholders';

  const stale = [
    copy.state === 'stale' ? 'copy approval' : null,
    numbers.state === 'stale' ? 'figure verification' : null,
  ].filter(Boolean);
  if (stale.length) return `Template changed since ${stale.join(' and ')} — needs signing again`;

  const missing = [
    copy.state === 'none' ? 'copy approval' : null,
    numbers.state === 'none' ? 'figure verification' : null,
  ].filter(Boolean);
  if (missing.length === 2) return 'Approval: none on record';
  if (missing.length === 1) return `Waiting on ${missing[0]}`;

  return 'Approved and verified';
}

/**
 * Should the sequence be shown as running?
 *
 * "A sequence without approval cannot display as active" — the app cannot stop Smartlead
 * sending, so what it can honestly do is refuse to present an unapproved campaign as
 * though somebody had checked it. The platform's own status is still shown beside this.
 */
export function displayStatus(platformStatus: string, fit: Fitness): string {
  if (platformStatus === 'active' && !fit.fitToSend) return 'active · unapproved';
  return platformStatus;
}
