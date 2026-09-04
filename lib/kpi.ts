import { delta } from './calc.ts';

// The KPI shape and its delta arithmetic, split out of lib/metrics.ts so a client
// component can render a card without dragging the database into the browser bundle.
//
// lib/metrics.ts imports lib/prisma. `MetricsBand` is a client component and renders
// `KpiCard`, so anything KpiCard imports as a VALUE lands in the client graph — and a
// value import of lib/metrics would follow the chain into the `pg` driver and break the
// build. Only lib/calc.ts is imported here, which imports nothing.

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: 'number' | 'money' | 'percent' | 'ratio' | 'duration' | 'days';
  /** False where a rise is bad, so the delta colour is not simply "up is green". */
  higherIsBetter: boolean;
  /** ISO code for a `money` KPI. Carried on the card because the reporting currency is a
   *  workspace setting, and a client component cannot read it for itself. */
  currency?: string;
  hint?: string;
  /** Source ids that actually wrote the data behind this figure — resolved against the
   *  live tables, not assumed, so a card can say where its number really came from.
   *  Rendered through lib/sources.ts, which imports nothing. */
  sources?: string[];
  /** Why there is no change chip, when the reason is that the data does not reach back
   *  far enough. Without it the card said "No prior period", which reads as "nothing
   *  happened then" rather than "we were not recording yet". */
  comparisonNote?: string;
};

/** Percentage change against the prior period, or null with nothing to compare to. */
export const kpiDelta = (k: Kpi): number | null =>
  k.value === null || k.previous === null ? null : delta(k.value, k.previous);

/**
 * Which imported series each KPI is built from.
 *
 * A change chip is only honest if the data reaches back into the period being compared
 * against. GA4 was connected on 27 July and Meta Ads a day earlier, so a 30-day view
 * compared a full month of sessions against the three days that existed in the previous
 * window and printed "+800.9%" — the date an integration was switched on, rendered as
 * growth. Revenue has a milder version of the same problem: it starts in November 2024,
 * so a 365-day comparison reaches two months past the beginning of the data.
 *
 * A card listing more than one series is blind if ANY of them falls short, because the
 * ratio is only as trustworthy as its thinnest input.
 */
export type KpiSeries = 'sessions' | 'spend' | 'leads' | 'deals' | 'revenue' | 'customers';

export const KPI_SERIES: Record<string, KpiSeries[]> = {
  visitors: ['sessions'],
  sessions: ['sessions'],
  users: ['sessions'],
  pageviews: ['sessions'],
  visitorToLead: ['sessions', 'leads'],

  spend: ['spend'],
  cpl: ['spend', 'leads'],
  cac: ['spend', 'customers'],
  roas: ['spend', 'revenue'],

  leads: ['leads'],
  qualified: ['leads'],
  leadToQualified: ['leads'],
  unassigned: ['leads'],
  response: ['leads'],
  duplicates: ['leads'],
  converted: ['leads'],

  opportunities: ['deals'],
  openDeals: ['deals'],
  weighted: ['deals'],
  totalValue: ['deals'],
  winRate: ['deals'],
  cycle: ['deals'],
  oppToCustomer: ['deals', 'customers'],

  revenue: ['revenue'],
  newRevenue: ['revenue'],
  repeatRevenue: ['revenue'],
  avgAccount: ['revenue'],

  customers: ['customers'],
  companies: ['customers'],
  contacts: ['customers'],
};

/**
 * True when every series behind `key` has data going back to `windowFrom`.
 *
 * A series with no data at all is not comparable either — there is nothing to compare.
 * A key nobody has mapped is left alone rather than silently blanked: the caller keeps
 * whatever previous value it had.
 */
export function kpiIsComparable(
  key: string,
  windowFrom: Date,
  starts: Partial<Record<KpiSeries, Date | null>>,
): boolean {
  const series = KPI_SERIES[key];
  if (!series) return true;
  return series.every((s) => {
    const start = starts[s];
    return !!start && start.getTime() <= windowFrom.getTime();
  });
}

/** Human label for a series, for the "we were not recording yet" note. */
export const SERIES_LABEL: Record<KpiSeries, string> = {
  sessions: 'Analytics',
  spend: 'Ad spend',
  leads: 'Lead',
  deals: 'Deal',
  revenue: 'Revenue',
  customers: 'Customer',
};
