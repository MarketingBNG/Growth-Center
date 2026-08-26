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
  rangeFor,
  repeatCustomerRate,
  trend,
} from './metrics.ts';
import type { Kpi } from './kpi.ts';
import type { Funnel } from './metrics.ts';
import { fmtMoney, fmtNumber, fmtPercent, fmtRatio } from './format.ts';

// Assembles the analytics band for one screen. Lives here rather than in the pages so
// the band's figures come from lib/metrics.ts like every other number, and so five
// pages do not each grow their own copy of this wiring.

export type BandSeries = { key: string; label: string; kind: 'number' | 'money' };

export type BandData = {
  kpis: Kpi[];
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

/** "On track for 40% target", or the honest alternative. Never claims a target is met
 *  when there is no number to compare against it. */
function targetNote(value: number | null, target: number | null, subject: string): string {
  if (value === null) return `No ${subject} to measure in this period`;
  if (target === null) return subject;
  return value >= target
    ? `Above the ${target}% target`
    : `On track for ${target}% target`;
}

export async function leadsBand(days: number, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = rangeFor(days);
  const [{ cards, current: f, weekday, qualificationRate }, series] = await Promise.all([
    leadsKpis(days),
    trend(current, bucket),
  ]);

  return {
    kpis: cards,
    trend: {
      title: 'Leads created',
      subtitle: 'By day',
      headline: fmtNumber(f.leads),
      note: `${fmtNumber(f.qualified)} reached qualified`,
      data: series,
      series: [{ key: 'leads', label: 'Leads', kind: 'number' }],
    },
    weekday: { data: weekday },
    gauge: {
      title: 'Qualification rate',
      value: qualificationRate,
      target: 40,
      note: targetNote(qualificationRate, 40, 'qualified leads'),
    },
  };
}

export async function crmBand(days: number, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = rangeFor(days);
  const [{ cards, customerShare: share, weekday }, series] = await Promise.all([
    crmKpis(days),
    accountsTrend(current, bucket),
  ]);

  const added = series.reduce((sum, r) => sum + r.accounts, 0);

  return {
    kpis: cards,
    trend: {
      title: 'Accounts added',
      subtitle: 'Companies and contacts, by day',
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

export async function pipelineBand(days: number, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = rangeFor(days);
  const [{ cards, open, winRate: wr, weekday }, series] = await Promise.all([
    pipelineKpis(days),
    pipelineTrend(current, bucket),
  ]);

  const created = series.reduce((sum, r) => sum + r.created, 0);

  return {
    kpis: cards,
    trend: {
      title: 'Pipeline created',
      subtitle: 'Deal value by the day it opened',
      headline: fmtMoney(created),
      note: `${fmtMoney(open.weighted)} of the open pipeline, weighted by probability`,
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

export async function marketingBand(days: number, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = rangeFor(days);
  const [{ cards, current: f, budgetPacing: pacing, weekday }, series] = await Promise.all([
    marketingKpis(days),
    trend(current, bucket),
  ]);

  return {
    kpis: cards,
    trend: {
      title: 'Revenue and spend',
      subtitle: 'By day · they share a unit, so they share a chart',
      headline: fmtMoney(f.revenue),
      note: `${fmtMoney(f.spend)} spent · ${fmtRatio(f.roas)} return`,
      data: series,
      series: [
        { key: 'revenue', label: 'Revenue', kind: 'money' },
        { key: 'spend', label: 'Spend', kind: 'money' },
      ],
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

export async function analyticsBand(days: number, bucket: 'day' | 'month'): Promise<BandData> {
  const { current } = rangeFor(days);
  const [{ cards, current: f, weekday }, series, repeat] = await Promise.all([
    analyticsKpis(days),
    trend(current, bucket),
    repeatCustomerRate(),
  ]);

  return {
    kpis: cards,
    trend: {
      title: 'Revenue and spend',
      subtitle: 'By day · never a second y-axis',
      headline: fmtMoney(f.revenue),
      note: 'Sessions and leads sit on their own charts',
      data: series,
      series: [
        { key: 'revenue', label: 'Revenue', kind: 'money' },
        { key: 'spend', label: 'Spend', kind: 'money' },
      ],
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
  days: number,
  bucket: 'day' | 'month',
): Promise<{ band: BandData; funnel: Funnel }> {
  const { current } = rangeFor(days);
  const [{ cards, current: f }, series, weekday, repeat] = await Promise.all([
    kpis(days),
    trend(current, bucket),
    leadsByWeekday(current),
    repeatCustomerRate(),
  ]);

  const WANTED = ['visitors', 'leads', 'revenue', 'cac', 'roas'];
  const picked = WANTED.map((key) => cards.find((c) => c.key === key)).filter(
    (c): c is Kpi => c !== undefined,
  );

  return {
    // The funnel comes back too: the dashboard draws it and its conversion footer from
    // the same period, and recomputing it would be another seven queries.
    funnel: f,
    band: {
      kpis: picked,
      trend: {
        title: 'Revenue and spend',
        subtitle:
          bucket === 'month'
            ? 'By month · they share a unit, so they share a chart'
            : 'By day · they share a unit, so they share a chart',
        headline: fmtMoney(f.revenue),
        note: `${fmtMoney(f.spend)} spent · ${fmtRatio(f.roas)} return`,
        data: series,
        series: [
          { key: 'revenue', label: 'Revenue', kind: 'money' },
          { key: 'spend', label: 'Marketing spend', kind: 'money' },
        ],
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
