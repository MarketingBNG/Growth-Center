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

/** The four kinds an insight can be, matching the InsightKind enum in the schema. Here so
 *  the structured-output schema in lib/ai.ts and the badges that render them cannot drift
 *  apart from each other. */
export const INSIGHT_KINDS = ['opportunity', 'risk', 'anomaly', 'recommendation'] as const;

export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * The environment variable that switches AI answers on.
 *
 * Here, and named once, because four screens print it as instructions to the reader —
 * the AI page, the Ask box's placeholder, the dashboard's insight card and the settings
 * checklist. All four said ANTHROPIC_API_KEY after the provider changed to OpenAI, which
 * is worse than saying nothing: it tells the person to set a variable that has no effect.
 */
export const AI_KEY_ENV = 'OPENAI_API_KEY';

/**
 * The two kinds of work this application shows, and how a Task row is sorted into one.
 *
 * §19.1 asks for the split, and it is not cosmetic. "Call this lead back" and "ship the
 * Zoho integration" are different jobs, done by different people, judged on different
 * clocks — and until now they shared one undifferentiated list, so opening Tasks showed
 * 6,392 CRM follow-ups with delivery work buried somewhere inside it.
 *
 * Derived from `source` rather than stored as a column. The source is already written by
 * whichever integration created the row, it cannot drift from it, and a stored copy would
 * be a second fact about the same thing — this repository's documented failure mode.
 *
 * `zoho_projects` is delivery; everything else — the CRM, anything created here by hand —
 * is relationship work. A source nobody recognises falls to `crm`, which is where an
 * unrecognised task most likely belongs and, more importantly, keeps it visible: the
 * alternative is a task that belongs to neither filter and can never be found.
 */
export const TASK_KINDS = ['crm', 'delivery'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Sources that mean delivery work rather than CRM follow-up. */
export const DELIVERY_TASK_SOURCES = ['zoho_projects'];

export function taskKind(source: string | null | undefined): TaskKind {
  return source && DELIVERY_TASK_SOURCES.includes(source) ? 'delivery' : 'crm';
}

/** The Prisma `where` fragment for one kind, or undefined for both. Kept beside taskKind
 *  so the filter and the label can never disagree about what a kind means. */
export function taskKindWhere(kind: string | null | undefined): Record<string, unknown> | undefined {
  if (kind === 'delivery') return { source: { in: DELIVERY_TASK_SOURCES } };
  // Null included deliberately: a hand-made task has no source and is CRM work.
  if (kind === 'crm') return { OR: [{ source: null }, { source: { notIn: DELIVERY_TASK_SOURCES } }] };
  return undefined;
}
