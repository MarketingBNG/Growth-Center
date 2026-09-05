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
