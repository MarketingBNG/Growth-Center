import { RANGE_OPTIONS } from './enums.ts';

// `today` is the CRM screen's own spelling of a one-day window and stays accepted so its
// existing links keep working. RANGE_OPTIONS now carries '1' for the same span — the
// shared picker was asked for a one-day preset — so the two are the same window under two
// names, and only `today` is absent from the shared control.
const ALLOWED = [...RANGE_OPTIONS.map((o) => o.value), 'today'] as readonly string[];

/** Validates ?range= against the allow-list so a hand-edited URL cannot ask for an
 *  arbitrary window. Defaults to 30 days. */
export function rangeParam(params: Record<string, string | string[] | undefined>): {
  value: string;
  days: number;
  bucket: 'day' | 'month';
} {
  const raw = typeof params.range === 'string' ? params.range : '';
  const value = ALLOWED.includes(raw) ? raw : '30';
  const days = value === 'today' ? 1 : Number(value);
  return { value, days, bucket: bucketFor(days) };
}

/** Daily points up to four months, monthly beyond — a two-year window plotted by day is
 *  730 unreadable pixels. Shared so a hand-picked range buckets like a preset of the
 *  same length. */
export function bucketFor(days: number): 'day' | 'month' {
  return days > 120 ? 'month' : 'day';
}

/** ISO calendar day, `YYYY-MM-DD`, and nothing else — the shape a date input produces. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type CustomRange = { from: Date; to: Date; label: string; days: number };

/**
 * `?from=&to=` for a hand-picked window, validated the same way `?range=` is.
 *
 * Null unless BOTH dates are present and well formed: half a range is not a range, and
 * silently completing it with today would show a window nobody asked for.
 *
 * Reversed dates are swapped rather than rejected. Picking the end first is an ordinary
 * slip with an obvious intent, and an empty screen would not explain itself.
 *
 * Capped at five years so a crafted URL cannot ask for a scan of the whole table.
 */
export function customRange(params: Record<string, string | string[] | undefined>): CustomRange | null {
  const a = utcDay(typeof params.from === 'string' ? params.from : undefined);
  const b = utcDay(typeof params.to === 'string' ? params.to : undefined);
  if (!a || !b) return null;

  const [start, end] = a <= b ? [a, b] : [b, a];
  const to = new Date(end);
  to.setUTCHours(23, 59, 59, 999);

  const MAX_DAYS = 365 * 5;
  const spanDays = Math.floor((to.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_DAYS) return null;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: start, to, label: `${iso(start)} – ${iso(end)}`, days: spanDays };
}

export type ResolvedRange = {
  /** The preset's own value ('7', '30', 'today', ...), for RangePicker. */
  value: string;
  /** The preset's day count, even when a custom range wins — some pages still need it
   *  (an export link, a fallback windowFor call). */
  days: number;
  /** picked ?? days: what a metric function taking `number | Range` wants. */
  spec: number | CustomRange;
  /** The picked window if one was given, otherwise null — for pages that branch on it. */
  picked: CustomRange | null;
  bucket: 'day' | 'month';
  /** The preset's own label ("Last 6 months") or the picked window's date span, never
   *  the generic "Last N days" that reads oddly for a preset already named otherwise. */
  label: string;
};

/**
 * The search params a page receives, already awaited. Written out inline in a dozen page
 * signatures and never named, so a change to the shape meant finding all twelve.
 */
export type PageParams = Record<string, string | string[] | undefined>;

/**
 * Every dashboard-shaped page's range in one call: which preset or custom window is
 * asked for, what a metric function should be given, and what bucket and label to show.
 *
 * Was six lines and a repeated comment, copied into eight pages, because a hand-picked
 * window from the calendar wins over the preset — the two are the same setting
 * (RangePicker clears one when the other is chosen) and this only has to say which it
 * prefers when both somehow appear in a URL.
 */
export function resolveRange(params: PageParams): ResolvedRange {
  const { value, days, bucket: presetBucket } = rangeParam(params);
  const picked = customRange(params);
  const spec = picked ?? days;
  const bucket = picked ? bucketFor(picked.days) : presetBucket;
  // The preset's own label rather than `Last ${days} days`, which read "Last 180 days"
  // for the six-month window and "Last 365 days" for the year.
  const label = picked
    ? picked.label
    : value === 'today'
      ? 'Last 1 day'
      : (RANGE_OPTIONS.find((o) => o.value === value)?.label ?? `Last ${days} days`);
  return { value, days, spec, picked, bucket, label };
}

/**
 * A period, as every metric function takes one.
 *
 * Here rather than in lib/metrics.ts because lib/attribution.ts needs the window
 * arithmetic and lib/metrics.ts already imports lib/attribution.ts. Date maths has no
 * business creating an import cycle, and a second copy of it in the other module is how
 * two parts of one product come to disagree about where a year starts.
 */
export type Range = { from: Date; to: Date };

/** A period and the equally-long period immediately before it, for deltas. */
export function rangeFor(days: number, now = new Date()): { current: Range; previous: Range } {
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);

  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  prevTo.setUTCHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  prevFrom.setUTCHours(0, 0, 0, 0);

  return { current: { from, to }, previous: { from: prevFrom, to: prevTo } };
}
