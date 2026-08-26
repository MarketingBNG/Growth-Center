const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(n: number | null | undefined, precise = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return precise ? moneyPrecise.format(n) : money.format(n);
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) < 1000) return String(Math.round(n));
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

/** Small rates get more precision automatically: at one decimal a 0.34% conversion
 *  rendered as "0.3%" in a KPI and "0.34%" in the footer of the same screen. */
export function fmtPercent(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const places = digits ?? (Math.abs(n) < 1 ? 2 : 1);
  return `${n.toFixed(places)}%`;
}

export function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}×`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDay(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const date = typeof d === 'string' ? new Date(d) : d;
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(date);
}

/** Percentage change, or null when there is no baseline to compare against. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/** A span of hours as "3h 12m" — the shape an operations number wants. Sub-hour spans
 *  drop to minutes so a 12-minute median does not render as "0h 12m". */
export function fmtDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  const mins = Math.round(hours * 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A span of days, for sales-cycle length. */
export function fmtDays(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return '—';
  return `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
}

/** Money for an axis tick: "$450K", not "$450,000". The long form overflowed a 46px
 *  axis gutter and was clipped mid-number, which read as a wrong value rather than a
 *  truncated one. */
export function fmtMoneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n === 0) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: Math.abs(n) < 10_000 ? 1 : 0,
  }).format(n);
}
