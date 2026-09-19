// The vocabularies the facts form reads.
//
// Pure and importing nothing, so a client component can render the form without dragging
// a Prisma client into the bundle — the same split lib/shared/thresholds.ts documents.

/**
 * Where a fact applies.
 *
 * The pack's §3.11: facts, clusters and pages carry a jurisdiction, and nothing may assume
 * US-only or India-only. The state entries are the ones this firm actually advises on;
 * adding another is a line here, not a migration, which is why `jurisdiction` is a string
 * column rather than an enum.
 */
export const JURISDICTIONS = [
  'US-FED',
  'US-CA',
  'US-NY',
  'US-TX',
  'US-DE',
  'US-NJ',
  'IN',
  'TREATY-US-IN',
] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Record<string, string> = {
  'US-FED': 'United States — federal',
  'US-CA': 'California',
  'US-NY': 'New York',
  'US-TX': 'Texas',
  'US-DE': 'Delaware',
  'US-NJ': 'New Jersey',
  IN: 'India',
  'TREATY-US-IN': 'US–India treaty',
};

/** What each state of a fact means, shown beside the badge. */
export const FACT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Awaiting review',
  approved: 'Approved',
  retired: 'Retired',
};

export const FACT_STATUS_HINTS: Record<string, string> = {
  draft: 'Entered, not yet put up for review. Cannot be used in a draft.',
  proposed: 'Waiting on a CA or CPA. Cannot be used in a draft yet.',
  approved: 'Cleared by a named reviewer. This is the only state an article may cite.',
  retired: 'Superseded or withdrawn. Kept because published articles cite it.',
};

/** The badge colour for each state. Beside the labels so the two cannot drift. */
export function factTone(status: string): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'approved') return 'success';
  if (status === 'proposed') return 'warning';
  if (status === 'retired') return 'neutral';
  return 'info';
}

export const jurisdictionLabel = (code: string) => JURISDICTION_LABELS[code] ?? code;
