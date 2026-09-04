import {
  accountsTrend,
  analyticsKpis,
  crmKpis,
  kpis,
  leadsByWeekday,
  leadsKpis,
  marketingKpis,
  pipelineKpis,
  pipelineTrend,
  repeatCustomerRate,
  windowFor,
  sessionsStart,
  spendStart,
  trend,
} from './metrics.ts';
import type { Kpi } from './kpi.ts';
import type { Funnel, Range } from './metrics.ts';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent, fmtRatio } from './format.ts';
import { TAGS, cached } from './cache.ts';

// Assembles the analytics band for one screen. Lives here rather than in the pages so
// the band's figures come from lib/metrics.ts like every other number, and so five
// pages do not each grow their own copy of this wiring.

export type BandSeries = { key: string; label: string; kind: 'number' | 'money' };

export type BandData = {
  kpis: Kpi[];
  /** The workspace's reporting currency, carried so the chart a band feeds can label its
   *  axis with the right symbol. The band's own headlines are already formatted. */
  currency: string;
  trend: {
    title: string;
    subtitle?: string;
    headline?: string;
    note?: string;
    data: { date: string; [key: string]: string | number }[];
    series: BandSeries[];
  };
  weekday: { data: { label: string; value: number }[] };
  gauge: { title: string; value: number | null; note?: string; target?: number | null };
};

/**
 * The reporting currency, taken from the cards the band is built from.
 *
 * Read off the KPIs rather than fetched again: the money cards already carry it, having
 * been built from a funnel that converted with it, and a second read could disagree with
 * the figures beside it if the setting changed mid-request.
 */
function currencyOf(cards: Kpi[]): string {
  return cards.find((c) => c.format === 'money' && c.currency)?.currency ?? 'USD';
}

/** "On track for 40% target", or the honest alternative. Never claims a target is met
 *  when there is no number to compare against it. */
function targetNote(value: number | null, target: number | null, subject: string): string {
  if (value === null) return `No ${subject} to measure in this period`;
  if (target === null) return subject;
  return value >= target
    ? `Above the ${target}% target`
    : `On track for ${target}% target`;
}

/** The chart's own unit, which follows the bucket `rangeFor` picked. Hard-coded "By day"
 *  labelled a monthly-bucketed series as daily on every range over 120 days. */
const by = (bucket: 'day' | 'month', rest = '') =>
  `By ${bucket === 'month' ? 'month' : 'day'}${rest}`;

export async function leadsBand(spec: number | Range, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = windowFor(spec);
  const [{ cards, current: f, weekday, qualificationRate }, series] = await Promise.all([
    leadsKpis(spec),
    trend(current, bucket),
  ]);

  const fx = currencyOf(cards);

  return {
    kpis: cards,
    currency: fx,
    trend: {
      title: 'Leads created',
      subtitle: by(bucket),
      headline: fmtNumber(f.leads),
      note: `${fmtNumber(f.semiQualified)} reached semi-qualified`,
      data: series,
      series: [{ key: 'leads', label: 'Leads', kind: 'number' }],
    },
    weekday: { data: weekday },
    gauge: {
      // Semi-qualified, matching the card, and with no target. The 40% target was invented
      // here, and measured against `qualified` — a status this CRM stamps only on
      // conversion — it read 1% and still said "on track for 40%".
      title: 'Semi-qualified rate',
      value: qualificationRate,
      target: null,
      note: targetNote(qualificationRate, null, 'Share of leads that reached semi-qualified'),
    },
  };
}

export async function crmBand(spec: number | Range, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = windowFor(spec);
  const [{ cards, customerShare: share, weekday }, series] = await Promise.all([
    crmKpis(spec),
    accountsTrend(current, bucket),
  ]);

  const added = series.reduce((sum, r) => sum + r.accounts, 0);

  const fx = currencyOf(cards);

  return {
    kpis: cards,
    currency: fx,
    trend: {
      title: 'Accounts added',
      subtitle: `Companies and contacts, ${by(bucket).toLowerCase()}`,
      headline: fmtNumber(added),
      note: share === null ? 'No companies on the books yet' : `${fmtPercent(share)} of accounts are customers`,
      data: series,
      series: [{ key: 'accounts', label: 'Accounts', kind: 'number' }],
    },
    weekday: { data: weekday },
    gauge: {
      title: 'Customer share',
      value: share,
      target: null,
      note: 'Share of all companies that are customers — a snapshot, not this period',
    },
  };
}

export async function pipelineBand(spec: number | Range, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = windowFor(spec);
  const [{ cards, open, winRate: wr, weekday }, series] = await Promise.all([
    pipelineKpis(spec),
    pipelineTrend(current, bucket),
  ]);

  const created = series.reduce((sum, r) => sum + r.created, 0);

  const fx = currencyOf(cards);
  const money = (n: number | null | undefined) => fmtMoney(n, false, fx);

  return {
    kpis: cards,
    currency: fx,
    trend: {
      title: 'Pipeline created',
      subtitle: 'Deal value by the day it opened',
      headline: money(created),
      note: `${money(open.weighted)} of the open pipeline, weighted by probability`,
      data: series,
      series: [{ key: 'created', label: 'Pipeline created', kind: 'money' }],
    },
    weekday: { data: weekday },
    gauge: {
      title: 'Win rate',
      value: wr,
      target: 50,
      note: targetNote(wr, 50, 'decided deals'),
    },
  };
}

async function readMarketingBand(
  spec: number | Range,
  bucket: 'day' | 'month',
  channelId?: string,
): Promise<BandData> {
  const { current } = windowFor(spec);
  const [{ cards, current: f, budgetPacing: pacing, weekday }, series] = await Promise.all([
    marketingKpis(spec, channelId),
    trend(current, bucket, channelId),
  ]);

  const fx = currencyOf(cards);
  const money = (n: number | null | undefined) => fmtMoney(n, false, fx);

  return {
    kpis: cards,
    currency: fx,
    trend: {
      // Revenue alone. Sharing a unit is not sharing a scale: this account books revenue
      // four orders of magnitude above its daily ad spend, so the spend line lay flat on
      // the axis while the subtitle claimed to be showing it. Spend has its own chart.
      title: 'Revenue booked',
      subtitle: by(bucket),
      headline: money(f.revenue),
      note: `${money(f.spend)} spent · ${fmtRatio(f.roas)} return · charted separately`,
      data: series,
      series: [{ key: 'revenue', label: 'Revenue', kind: 'money' }],
    },
    weekday: { data: weekday },
    gauge: {
      title: 'Budget pacing',
      value: pacing,
      target: 100,
      note:
        pacing === null
          ? 'No live campaign carries a budget'
          : pacing > 100
            ? 'Over the budget of the campaigns live this period'
            : 'Spend against the budget of the campaigns live this period',
    },
  };
}

async function readAnalyticsBand(spec: number | Range, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = windowFor(spec);
  const [{ cards, current: f, weekday }, series, repeat] = await Promise.all([
    analyticsKpis(spec),
    trend(current, bucket),
    repeatCustomerRate(),
  ]);

  const fx = currencyOf(cards);
  const money = (n: number | null | undefined) => fmtMoney(n, false, fx);

  return {
    kpis: cards,
    currency: fx,
    trend: {
      // Revenue alone. Pairing it with spend on this chart broke the one rule the chart
      // has: a single shared y-axis. Booked revenue runs four orders of magnitude above
      // daily ad spend, so the spend line sat flat on the axis, unreadable, while the
      // subtitle claimed to be showing it. Spend has its own chart on the page.
      title: 'Revenue booked',
      subtitle: by(bucket),
      headline: money(f.revenue),
      note: 'Ad spend, sessions and leads each sit on their own chart',
      data: series,
      series: [{ key: 'revenue', label: 'Revenue', kind: 'money' }],
    },
    weekday: { data: weekday },
    gauge: {
      title: 'Repeat customer rate',
      value: repeat,
      target: null,
      note: 'Customers who have billed more than once — a snapshot, not this period',
    },
  };
}

/** Dashboard: Visitors · Leads · Revenue · CAC · ROAS.
 *
 *  Picked out of the full `kpis()` set rather than recomputed, so the dashboard cannot
 *  disagree with any other screen showing the same figure. */
export async function dashboardBand(
  spec: number | Range,
  bucket: 'day' | 'month',
): Promise<{ band: BandData; funnel: Funnel; visitorsFrom: Date | null }> {
  const { current } = windowFor(spec);
  const [{ cards, current: f }, series, weekday, repeat, sessionsFrom, spendFrom] = await Promise.all([
    kpis(spec),
    trend(current, bucket),
    leadsByWeekday(current),
    repeatCustomerRate(),
    sessionsStart(),
    spendStart(),
  ]);

  // Non-null only when the sessions series starts INSIDE the window, which is the case
  // where the visitor count covers less time than every other stage of the funnel.
  const visitorsFrom =
    sessionsFrom && sessionsFrom.getTime() > current.from.getTime() ? sessionsFrom : null;

  // Same test for spend. The ROAS card is already blanked over a window spend does not
  // cover, and this note sits two inches from it printing the very figure the card
  // declined to state.
  const spendShort = !spendFrom || spendFrom.getTime() > current.from.getTime();

  // New business and repeat sit beside Revenue rather than replacing it. G1.4 asks for
  // renewals to have their own card, and the reason is that the three are only meaningful
  // together: "New business" alone invites the reader to assume it is the whole book,
  // which is the misreading the split exists to end.
  // Unclassified sits with New and Repeat, not apart from them. The three are a partition
  // of Revenue, and showing two of the three invites the reader to take them as the whole
  // book — the same misreading the split was built to end.
  const WANTED = ['visitors', 'leads', 'revenue', 'newRevenue', 'repeatRevenue', 'unclassifiedRevenue', 'cac', 'roas'];
  const picked = WANTED.map((key) => cards.find((c) => c.key === key)).filter(
    (c): c is Kpi => c !== undefined,
  );

  // Taken from the funnel rather than the picked cards: the dashboard shows a subset, and
  // a selection that happened to exclude every money card would lose the currency.
  const money = (n: number | null | undefined) => fmtMoney(n, false, f.currency);

  return {
    // The funnel comes back too: the dashboard draws it and its conversion footer from
    // the same period, and recomputing it would be another seven queries.
    funnel: f,
    visitorsFrom,
    band: {
      kpis: picked,
      // From the funnel rather than the picked cards: the dashboard shows a subset, and a
      // selection that happened to exclude every money card would lose the currency.
      currency: f.currency,
      trend: {
        // See marketingBand: revenue and spend do not share a scale, so they no longer
        // share a chart. Spend is plotted on its own beneath the band.
        title: 'Revenue booked',
        subtitle: by(bucket),
        headline: money(f.revenue),
        note: spendShort
          ? `${money(f.spend)} spent, but only from ${fmtDate(spendFrom)} — too little of the period to state a return`
          : `${money(f.spend)} spent · ${fmtRatio(f.roas)} return · charted separately`,
        data: series,
        series: [{ key: 'revenue', label: 'Revenue', kind: 'money' }],
      },
      weekday: { data: weekday },
      gauge: {
        title: 'Repeat customer rate',
        value: repeat,
        target: null,
        note: 'Customers who have billed more than once — a snapshot, not this period',
      },
    },
  };
}

/**
 * The KPI rows on Analytics and Marketing.
 *
 * Caching `trend` and `channelPerformance` underneath these was not enough — each band
 * also runs its own KPI batch, a weekday breakdown and a repeat-customer rate, and those
 * were still going to the database on every view. /analytics stayed at roughly 1.5s warm
 * with everything below it cached, which is what pointed here.
 *
 * Both read the same daily snapshots as the charts they sit above, so they carry the
 * same tag and go stale at the same moment. The leads, CRM and pipeline bands are
 * deliberately left uncached: those count records a user edits and expects to see move.
 */
export const analyticsBand = cached('band:analytics', [TAGS.metrics], readAnalyticsBand);
export const marketingBand = cached('band:marketing', [TAGS.metrics], readMarketingBand);
