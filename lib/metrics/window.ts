/**
 * The date arithmetic every metric stands on: which window is being asked for, what the
 * window before it was, and which bucket a date falls in.
 *
 * First out of the old 1,772-line metrics.ts because it is the one part that depends on
 * nothing — no database, no other metric — while almost everything else depends on it.
 * Kept separate so that stays true.
 */
import { rangeFor, type Range } from '../range.ts';


/** The equally-long period ending the instant before `range` starts. The comparison
 *  window for a hand-picked one, derived the same way `rangeFor` derives its own. */
export function previousOf(range: Range): Range {
  const span = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime() - 1);
  return { from: new Date(to.getTime() - span), to };
}

/**
 * A window and the period to compare it against, from either a preset day count or a
 * window someone picked on a calendar.
 *
 * The KPI functions took a day count alone, so a `?from=&to=` window reached the figures
 * a page computed for itself but never the cards and chart beside them: the CRM screen
 * could show June's leads over the last thirty days' companies, each labelled as though
 * it were the range in the picker.
 */

/**
 * A window and the period to compare it against, from either a preset day count or a
 * window someone picked on a calendar.
 *
 * The KPI functions took a day count alone, so a `?from=&to=` window reached the figures
 * a page computed for itself but never the cards and chart beside them: the CRM screen
 * could show June's leads over the last thirty days' companies, each labelled as though
 * it were the range in the picker.
 */
export function windowFor(spec: number | Range, now = new Date()): { current: Range; previous: Range } {
  return typeof spec === 'number'
    ? rangeFor(spec, now)
    : { current: spec, previous: previousOf(spec) };
}


/**
 * Seeded rows carry source 'demo'. Real ones carry the integration id.
 *
 * Once a provider has written even one row for a metric, the demo rows for that metric
 * must stop counting or the two are summed — connecting GA4 would have roughly doubled
 * the visitor count overnight, real sessions piled on top of invented ones.
 *
 * Scoped per metric, not globally, so a live Meta connection does not blank out the
 * seeded figures on pages nothing real writes to yet.
 */
/**
 * Wrapped in React's `cache` so one render asks once.
 *
 * `siteMetric` and `sessionsStart` both call this before every read, so a KPI band that
 * touches seven metric keys asked the same question seven times — measured as 54 queries
 * for analyticsBand, of which 24 were repeats. Keyed on the metric name, so the seven
 * distinct keys still cost seven queries; it is the repeats that go.
 *
 * Note this dedupes per render, not across requests — that is what the tag cache in
 * lib/cache.ts is for. The two stack: `cache` collapses the duplicates within one page,
 * `cached` keeps the result between pages.
 *
 * Only the reads taking no arguments or a primitive one are wrapped. React's cache keys
 * on argument identity, so a helper taking a freshly built `Range` object would miss on
 * every call and buy nothing — those need their queries batched instead, not memoised.
 */

// ─── per-screen trend series ──────────────────────────────────────────────────
//
// Bucketed the same way as trend(): one query, grouped in JS, because the date columns
// are DATE and a per-driver cast is not worth it at 365 rows.

export function bucketKey(d: Date, bucket: 'day' | 'month') {
  return bucket === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
}

/**
 * Every bucket across the range, in order, whether or not it has data.
 *
 * Without this a series only carries the buckets that happen to have rows, so a range
 * where all the activity landed on one day drew a single floating dot instead of a flat
 * line with a spike — it read as a broken chart rather than as "this all happened at
 * once". A gap in a time series means zero, and the axis has to say so.
 */

/** Days a campaign was live within the range, both ends included. An open-ended campaign
 *  runs to the end of the range; one that started before it began at the range's start. */
export function liveDays(
  campaign: { startDate: Date | null; endDate: Date | null },
  range: Range,
): number {
  const from = campaign.startDate && campaign.startDate > range.from ? campaign.startDate : range.from;
  const to = campaign.endDate && campaign.endDate < range.to ? campaign.endDate : range.to;
  const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return Math.max(1, days);
}

// ─── per-screen KPI sets ──────────────────────────────────────────────────────
//
// One builder per module screen, so the band is fed from here rather than from figures
// assembled in a page. Each returns the cards plus whatever the page also needs, to
// avoid a second round of the same queries.

/**
 * Leads converted in a period, counted by when they converted rather than when they
 * arrived — a lead created in June and converted in August belongs to August.
 */

const DAY_MS = 86_400_000;

/** Days a campaign was live within the range, both ends included. An open-ended campaign
 *  runs to the end of the range; one that started before it began at the range's start. */
