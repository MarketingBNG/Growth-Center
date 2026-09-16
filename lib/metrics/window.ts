/**
 * The date arithmetic every metric stands on: which window is being asked for, what the
 * window before it was, and which bucket a date falls in.
 *
 * First out of the old 1,772-line metrics.ts because it is the one part that depends on
 * nothing — no database, no other metric — while almost everything else depends on it.
 * Kept separate so that stays true.
 */
import { rangeFor, type Range } from '../shared/range.ts';

const DAY_MS = 86_400_000;

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
export function windowFor(spec: number | Range, now = new Date()): { current: Range; previous: Range } {
  return typeof spec === 'number'
    ? rangeFor(spec, now)
    : { current: spec, previous: previousOf(spec) };
}

/** Which bucket a date falls in. Grouped in JS by the callers rather than in SQL, because
 *  the date columns are DATE and a per-driver cast is not worth it at 365 rows. */
export function bucketKey(d: Date, bucket: 'day' | 'month') {
  return bucket === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
}

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
