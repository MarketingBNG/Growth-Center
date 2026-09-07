// §15.2's record: "title, type, topic cluster, segment, service line, target keyword,
// author, designer, partner voice, status, links to the asset and the published URL,
// publish date, and the performance join."
//
// "Everything the agent reviews and everything the reports count hangs off this record."
// The board had a title, a format and a brief.
//
// Vocabularies rather than enums, for the same reason the company facts are: these are
// chosen by a person from a dropdown, and a new service line should not be a migration.
// The lists live here so the form, the filters and the reports read one copy.

/**
 * The clock a content slot is written against.
 *
 * A label, not a conversion. `ContentPiece.publishMinute` is wall-clock minutes from
 * midnight and the firm is in one timezone — every slot in the studio's calendars is
 * written IST — so converting to UTC and back would add a class of off-by-five-and-a-half
 * hours bug in exchange for nothing. This is here so the UI can say which clock it means
 * rather than showing a bare "9:30" and leaving the reader to guess.
 *
 * If content ever has to be scheduled against a second timezone, that is a per-piece
 * column and a real change — not a matter of editing this string.
 */
export const CALENDAR_TIMEZONE = 'IST';

/** `570` → `"9:30 AM"`. Null passes through, because most pieces have no slot. */
export function formatSlot(minute: number | null | undefined): string | null {
  if (minute === null || minute === undefined) return null;
  const hour = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** `570` → `"09:30"`, for an `<input type="time">`. */
export function slotToInput(minute: number | null | undefined): string {
  if (minute === null || minute === undefined) return '';
  return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * How much of a brief is kept, everywhere that keeps one.
 *
 * 4,000 was a form limit standing in for a column limit that does not exist — `brief` is
 * Postgres text. A studio's master sheet carries the whole deliverable per post: the hook,
 * the five-slide script, the caption, the CTA. September 2026's is 59KB for 27 posts and
 * its longest single post copy is over 3,000 characters on its own, so 4,000 would import
 * the plan and throw away the work.
 *
 * Here rather than beside the importer for the same reason as FORMATS below: two of the
 * things that need it are client components.
 */
export const MAX_BRIEF = 20_000;

/**
 * The six values the `format` column holds.
 *
 * Here rather than beside the code that reads a spreadsheet, and rather than typed out
 * again in every form, for the reason this file exists: the form, the calendar's importer
 * and the create/patch schemas need the same list, and two of those are client
 * components. A client component that reaches into a module which can also reach the
 * database drags the `pg` driver into the browser bundle and the build dies on "Can't
 * resolve 'fs'" — see tools/client-boundary.test.ts, which has caught it four times now.
 */
export const FORMATS = ['blog', 'video', 'social', 'email', 'landing_page', 'case_study'] as const;
export type ContentFormat = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  blog: 'Blog',
  video: 'Video',
  social: 'Social',
  email: 'Email',
  landing_page: 'Landing page',
  case_study: 'Case study',
};

/**
 * §15.2's nine content types, verbatim.
 *
 * Wider than the existing `format` column, which has six values and reads as a technical
 * shape. These are what the studio actually produces, and "avatar video" and "partner
 * kit" are the two that had nowhere to go.
 */
export const CONTENT_TYPES = [
  'blog',
  'post',
  'carousel',
  'short',
  'long_video',
  'avatar_video',
  'webinar',
  'newsletter',
  'partner_kit',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  blog: 'Blog',
  post: 'Post',
  carousel: 'Carousel',
  short: 'Short',
  long_video: 'Long video',
  avatar_video: 'Avatar video',
  webinar: 'Webinar',
  newsletter: 'Newsletter',
  partner_kit: 'Partner kit',
};

/**
 * The service lines the firm sells, read off the source strings its own CRM records.
 *
 * Not invented: `leadCampaign` in crm-mapping.ts already derives these from 27,575 leads'
 * worth of Zoho source values, and a content board filed under different names from the
 * lead table would make "which service line does our content serve" unanswerable — which
 * is the join §15.2 exists to create.
 */
export const SERVICE_LINES = [
  'incorporation',
  'virtual_cfo',
  'compliance',
  'trademark',
  'canada_setup',
  'bookkeeping',
  'other',
] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const SERVICE_LINE_LABELS: Record<ServiceLine, string> = {
  incorporation: 'US incorporation',
  virtual_cfo: 'Virtual CFO',
  compliance: 'Compliance and tax',
  trademark: 'Trademark',
  canada_setup: 'Canada setup',
  bookkeeping: 'Bookkeeping',
  other: 'Other',
};

/**
 * Topic clusters, which are an SEO structure rather than a commercial one.
 *
 * Deliberately separate from service line even though they overlap: a cluster is a set of
 * pages that link to one another and compete for one family of terms, and the firm sells
 * one thing across several clusters and several things inside one. Collapsing them would
 * make §11.6's keyword work and §15.5's calendar the same axis, and they are not.
 */
export const TOPIC_CLUSTERS = [
  'us_entity_formation',
  'us_tax_compliance',
  'banking_and_payments',
  'fundraising',
  'cross_border_operations',
  'india_compliance',
  'firm_and_people',
] as const;
export type TopicCluster = (typeof TOPIC_CLUSTERS)[number];

export const TOPIC_CLUSTER_LABELS: Record<TopicCluster, string> = {
  us_entity_formation: 'US entity formation',
  us_tax_compliance: 'US tax and compliance',
  banking_and_payments: 'Banking and payments',
  fundraising: 'Fundraising',
  cross_border_operations: 'Cross-border operations',
  india_compliance: 'India compliance',
  firm_and_people: 'The firm and its people',
};

/**
 * Systems that create content items on their own. §15.4.
 *
 * "Hand-filled boards decay in three weeks. Auto-population is what keeps this screen
 * honest in month six." Recorded on the row because an auto-created item is a claim about
 * the outside world — this page exists, this post is scheduled — and a hand-made one is a
 * plan. The board reads differently if you cannot tell them apart.
 */
export const CONTENT_SOURCES = ['search_console', 'zoho_social', 'backstage'] as const;

export const label = <T extends string>(map: Record<T, string>, value: string | null | undefined) =>
  value && value in map ? map[value as T] : '—';
