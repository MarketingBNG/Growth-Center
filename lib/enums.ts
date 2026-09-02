// Values shared by client components and server code.
//
// Kept out of lib/leads.ts on purpose: that module imports lib/prisma, so a client
// component importing a constant from it pulled the `pg` driver into the browser
// bundle and the build failed on node:net. Anything a 'use client' file needs belongs
// here, where there are no imports at all.

export const LEAD_STATUSES = [
  'new', 'contacted', 'semi_qualified', 'qualified', 'unqualified', 'converted', 'lost',
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
  // The list the team asked for by name in the Sep 2 review: one day, a week, a fortnight,
  // a month, a quarter, six months, a year — plus the calendar, which the picker offers
  // beside these. Only 7/30/90/365 existed, so "last 14 days" and "last 6 months" could
  // not be asked for at all, and a single day only on the CRM screen.
  { value: '1', label: 'Last 1 day' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
] as const;

/** Prompts offered on the AI Insights page. Here rather than in lib/ai because AskBox
 *  is a client component and lib/ai imports the database. */
export const SUGGESTED_QUESTIONS = [
  'Which channel produces our highest-quality customers, and what is the evidence?',
  'Which campaigns have the best and worst return, and by how much?',
  'What changed between this period and the previous one?',
  'Where is the funnel leaking most?',
  'What are the biggest growth opportunities in this data?',
] as const;
