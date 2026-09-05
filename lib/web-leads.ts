// §16: visitor-to-lead was dividing every lead by the website's sessions.
//
// The two numbers describe different populations. GA4 measures usaindiacfo.com; most of
// this firm's leads never touch it. Over twelve months: **191,950 sessions and 15,830
// leads**, of which 7,477 arrived through Meta's in-platform lead forms (`fb`, `ig`),
// 2,772 through LinkedIn and 2,365 through WhatsApp — none of which is a website visit.
// Another 933 came through a second property (`BNG US Incorp`) that this GA4 account does
// not measure at all.
//
// Divided blended, the rate answers "how many leads did we get per website session",
// which nobody asked and which rises whenever the website does *worse*. The manual's
// objection is exactly this: the figure it saw was arithmetic over two unrelated sets.
//
// So the numerator is narrowed to the leads that plausibly passed through the measured
// site, and the page says which those are. The denominator is untouched.

/**
 * The channels whose leads arrive by visiting usaindiacfo.com.
 *
 * An allowlist, not a blocklist, and that direction is deliberate. `Channel` is a table
 * rather than an enum, so new slugs appear from the CRM without a deploy; an unrecognised
 * one is left out, which *understates* the conversion rate. Overstating it — claiming the
 * site converted a lead that never saw it — is the error being fixed, and a blocklist
 * would reintroduce it every time somebody added a channel.
 *
 * Counts are twelve months to 5 September 2026, read from the live database.
 *
 * - `landing-page` (882) — a form on the site. The clearest case there is.
 * - `direct` (78) — typed the address.
 * - `organic-search` (0 today) — search lands on the site by definition. Present so the
 *   rate is right the day SEO produces its first lead, rather than silently wrong.
 * - `google-ads` (153) — a search ad clicks through to the site, and GA4 records the
 *   session. Meta's do not, which is why `meta-ads` is not here.
 * - `email` (14) — a link in an email lands on the site.
 *
 * Deliberately absent:
 *
 * - `facebook`, `instagram`, `linkedin`, `whatsapp` (12,614 between them) — in-platform
 *   lead forms and chat threads. The person never reaches the website, so counting them
 *   makes the site look 11× better at converting than it is.
 * - `incorp` (933) — a different property, not in this GA4 account.
 * - `referral` (217) — "Ref by NG" is a person recommending the firm, not an HTTP
 *   referrer. The two share a word and nothing else.
 * - `events` (348), `outreach` (52) — met in a room, or written to first.
 * - `meta-ads`, `canada` (481) — Meta lead forms again, under a paid heading.
 */
export const WEB_ARRIVING_CHANNELS = [
  'landing-page',
  'direct',
  'organic-search',
  'google-ads',
  'email',
] as const;

const WEB = new Set<string>(WEB_ARRIVING_CHANNELS);

export function arrivesOnSite(slug: string | null | undefined): boolean {
  return slug != null && WEB.has(slug);
}

/**
 * The Prisma filter for the leads a site conversion rate is entitled to count.
 *
 * A lead with no channel at all is excluded. It is not evidence of a website visit, and
 * this workspace attributes 99.6% of its leads, so the residue is small and unknown
 * rather than large and probably-web.
 */
export const WEB_ARRIVING_LEAD = {
  channel: { is: { slug: { in: [...WEB_ARRIVING_CHANNELS] } } },
};

/**
 * What to tell the reader the rate is over.
 *
 * The rate is meaningless without it — 0.6% reads as a catastrophe next to a 24.1% that
 * was measuring something else — so the label travels with the number rather than living
 * in a tooltip somebody may not open.
 */
export const WEB_LEAD_BASIS =
  'Leads that arrived through the site — landing pages, direct, organic search, Google Ads and email. Social and WhatsApp leads are filled on the platform and never reach the website, so counting them here would credit the site with 12,614 visits it never had.';
