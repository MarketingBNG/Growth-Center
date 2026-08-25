// Values shared by client components and server code.
//
// Kept out of lib/leads.ts on purpose: that module imports lib/prisma, so a client
// component importing a constant from it pulled the `pg` driver into the browser
// bundle and the build failed on node:net. Anything a 'use client' file needs belongs
// here, where there are no imports at all.

export const LEAD_STATUSES = [
  'new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost',
] as const;

export const SOURCE_TYPES = [
  'website', 'landing_page', 'form', 'paid_ads', 'organic_search', 'social', 'referral',
  'outreach', 'event', 'import', 'manual',
] as const;

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const CONTENT_STATUSES = [
  'idea', 'planned', 'draft', 'review', 'published', 'archived',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Date-range choices for the dashboard/marketing/analytics pickers. Lives here rather
 *  than in lib/metrics because RangePicker is a client component. */
export const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
] as const;
