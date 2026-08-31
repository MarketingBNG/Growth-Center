import { RANGE_OPTIONS } from './enums.ts';

// `today` is offered by the CRM screen's picker but not by the shared one, so it lives
// here rather than in RANGE_OPTIONS — adding it there would put a Today button on every
// page whose figures are not meaningful over a single day.
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
