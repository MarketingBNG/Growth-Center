// Turning one CRM's vocabulary into this one's.
//
// Split out of service.ts because these are the only decisions in the CRM import that
// can be got wrong quietly — a mis-mapped stage moves money between pipeline columns and
// a mis-mapped status hides a live lead. Pure and import-free so tools/providers.test.ts
// can assert them without a database.

import type { LeadStatus, Priority, SourceType, TaskStatus } from '../generated/prisma/client.ts';

/**
 * Zoho's Lead_Status is free text configured per org, so anything unrecognised stays
 * `new` rather than being forced into a status nobody chose.
 *
 * Order matters: "Not Qualified" contains "qualified", so it has to be tested first.
 */
export function leadStatus(value: string | null | undefined): LeadStatus {
  const v = (value ?? '').toLowerCase();
  if (v.includes('convert')) return 'converted';
  // "Dead Lead" is this org's wording for a lead that went nowhere, and it is the single
  // most common status here — 22,554 leads read as untouched because nothing matched it.
  if (v.includes('lost') || v.includes('junk') || v.includes('dead')) return 'lost';
  // A job seeker is not a prospect. Unqualified rather than lost: nothing was lost.
  if (v.includes('not qualified') || v.includes('unqualified') || v.includes('looking for job')) {
    return 'unqualified';
  }
  if (v.includes('qualified')) return 'qualified';
  // "Follow-up" and "Not Reachable" both describe an attempt that has already been made,
  // which is what `contacted` means. Left as `new` they made the funnel's first stage
  // look untouched.
  if (
    v.includes('contact') ||
    v.includes('attempted') ||
    v.includes('follow') ||
    v.includes('not reachable') ||
    v.includes('unreachable')
  ) {
    return 'contacted';
  }
  return 'new';
}

/**
 * Maps Zoho's Lead_Source onto SourceType.
 *
 * `import` is the honest default: the lead did arrive by import, and claiming a channel
 * the CRM never named would put invented attribution into the funnel charts.
 */
export function leadSourceType(value: string | null | undefined): SourceType {
  const v = (value ?? '').toLowerCase();
  if (v.includes('referr') || v.includes('partner')) return 'referral';
  if (v.includes('landing')) return 'landing_page';
  if (v.includes('form')) return 'form';
  if (v.includes('advertis') || v.includes('ppc') || v.includes('adwords')) return 'paid_ads';
  if (v.includes('search') || v.includes('seo')) return 'organic_search';
  if (v.includes('social') || v.includes('facebook') || v.includes('twitter') || v.includes('linkedin'))
    return 'social';
  if (v.includes('cold') || v.includes('outreach') || v.includes('call')) return 'outreach';
  if (v.includes('seminar') || v.includes('trade show') || v.includes('event') || v.includes('conference'))
    return 'event';
  if (v.includes('web') || v.includes('chat')) return 'website';
  return 'import';
}

export type StageLike = {
  id: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
};

/**
 * Picks the PipelineStage a Zoho deal belongs in.
 *
 * Stage names are each org's own, so an exact (case-insensitive) name match is the only
 * reliable mapping. Zoho's two built-in closed stages are recognised by name because they
 * are near-universal. Everything else unrecognised lands in the first open stage — never
 * in Won or Lost, because a guess there would move real money into closed-won revenue.
 */
export function matchStage(stages: StageLike[], zohoStage: string | null | undefined): StageLike | null {
  if (!stages.length) return null;

  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const v = (zohoStage ?? '').trim().toLowerCase();

  const exact = ordered.find((s) => s.name.toLowerCase() === v);
  if (exact) return exact;

  if (v.includes('closed won')) {
    const won = ordered.find((s) => s.isWon);
    if (won) return won;
  }
  if (v.includes('closed lost')) {
    const lost = ordered.find((s) => s.isLost);
    if (lost) return lost;
  }

  return ordered.find((s) => !s.isWon && !s.isLost) ?? ordered[0];
}

/**
 * Zoho's Task Status onto TaskStatus.
 *
 * "Deferred" and "Waiting for input" are still open work — nobody has done them and
 * nobody has called them off — so they stay `open` rather than being hidden as done.
 */
export function taskStatus(value: string | null | undefined): TaskStatus {
  const v = (value ?? '').toLowerCase();
  if (v.includes('complet')) return 'done';
  if (v.includes('cancel')) return 'cancelled';
  if (v.includes('progress')) return 'in_progress';
  return 'open';
}

/**
 * Zoho's Task Priority onto Priority.
 *
 * Order matters: "Highest" and "Lowest" contain "high" and "low", so the extremes are
 * tested first or every Lowest task would arrive as low-but-not-lowest — and worse,
 * "Highest" would match the `high` test and lose its urgency.
 */
export function taskPriority(value: string | null | undefined): Priority {
  const v = (value ?? '').toLowerCase();
  if (v.includes('highest')) return 'urgent';
  if (v.includes('lowest')) return 'low';
  if (v.includes('high')) return 'high';
  if (v.includes('low')) return 'low';
  return 'normal';
}
