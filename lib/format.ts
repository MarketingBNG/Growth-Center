// Formatters are cached per currency: constructing an Intl.NumberFormat is not free and
// a table of money renders hundreds of cells.
const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, precise: boolean): Intl.NumberFormat {
  const key = `${currency}|${precise}`;
  let f = moneyFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: precise ? 2 : 0,
      maximumFractionDigits: precise ? 2 : 0,
    });
    moneyFormats.set(key, f);
  }
  return f;
}

/**
 * Money, in the workspace's reporting currency.
 *
 * The currency is a parameter rather than a constant because it is not always dollars:
 * this workspace bills its ads in rupees, and rendering those with a dollar sign made a
 * ₹292 cost per lead read as $292. Callers that have no currency to hand still get USD,
 * which is the default reporting currency.
 */
export function fmtMoney(
  n: number | null | undefined,
  precise = false,
  currency = 'USD',
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return moneyFormat(currency, precise).format(n);
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
export function fmtMoneyCompact(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n === 0) return fmtMoney(0, false, currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: Math.abs(n) < 10_000 ? 1 : 0,
  }).format(n);
}

/**
 * A URL that is safe to put in an `href`, or null.
 *
 * `content_piece.url`, `contact.linkedin` and `company.website` are validated as bounded
 * strings and nothing more, and two of them are rendered straight into an anchor. React
 * does not block a `javascript:` href, so a value written through the CRM API — or
 * arriving from a CRM import — would run as script in the browser of whoever clicked it.
 * Both fields are empty across the whole database today; this closes the path before
 * anything starts filling them.
 *
 * A bare domain is accepted and given an https scheme, because that is how people type a
 * website into a form. Anything whose scheme is not http or https returns null and the
 * caller renders plain text instead of a link.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  // No scheme and no colon at all: treat it as a bare domain rather than a relative
  // path, so "linkedin.com/in/someone" links out instead of inside the app.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}
