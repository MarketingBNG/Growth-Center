import { db } from './prisma.ts';
import { cac, delta, num, rate, roas } from './calc.ts';

// The one place dashboard, marketing and analytics numbers come from. If a figure
// appears on two pages it is computed here once, so the pages cannot disagree.

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

async function sessions(range: Range): Promise<number> {
  const result = await db().metricSnapshot.aggregate({
    where: { metricKey: 'sessions', date: { gte: range.from, lte: range.to } },
    _sum: { value: true },
  });
  return Math.round(num(result._sum.value));
}

/**
 * The funnel for one period.
 *
 * Qualified counts leads that reached qualified at any point, not leads currently
 * sitting in that status — otherwise converting a lead would decrease the qualified
 * count and the funnel would appear to leak backwards.
 */
export async function funnel(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [visitors, leads, qualified, opportunities, customers, revenueAgg, newRevenueAgg, spendAgg] =
    await Promise.all([
      sessions(range),
      db().lead.count({ where: { createdAt: window } }),
      db().lead.count({ where: { createdAt: window, qualifiedAt: { not: null } } }),
      db().opportunity.count({ where: { createdAt: window } }),
      db().customer.count({ where: { wonAt: window } }),
      db().revenueEntry.aggregate({ where: { date: window }, _sum: { amount: true } }),
      // New business only. Recurring income from customers won in earlier periods is
      // real revenue but it is NOT a return on this period's marketing spend — counting
      // it produced an 18x blended ROAS on a month where new business was a third of
      // the total.
      db().revenueEntry.aggregate({ where: { date: window, kind: 'one_time' }, _sum: { amount: true } }),
      db().marketingSpend.aggregate({ where: { date: window }, _sum: { amount: true } }),
    ]);

  const revenue = num(revenueAgg._sum.amount);
  const newRevenue = num(newRevenueAgg._sum.amount);
  const spend = num(spendAgg._sum.amount);

  return {
    visitors,
    leads,
    qualified,
    opportunities,
    customers,
    revenue,
    newRevenue,
    spend,
    visitorToLead: rate(leads, visitors),
    leadToQualified: rate(qualified, leads),
    qualifiedToOpportunity: rate(opportunities, qualified),
    opportunityToCustomer: rate(customers, opportunities),
    cac: cac(spend, customers),
    roas: roas(newRevenue, spend),
  };
}

export type Funnel = Awaited<ReturnType<typeof funnel>>;

/** Open pipeline, which is a snapshot rather than a period — a deal opened last year
 *  is still in the pipeline today, so this deliberately ignores the date range. */
export async function openPipeline() {
  const deals = await db().opportunity.findMany({
    where: { closedAt: null },
    select: { value: true, probability: true },
  });
  let total = 0;
  let weighted = 0;
  for (const d of deals) {
    const v = num(d.value);
    total += v;
    weighted += (v * d.probability) / 100;
  }
  return { count: deals.length, total, weighted };
}

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: 'number' | 'money' | 'percent' | 'ratio';
  /** False where a rise is bad, so the delta colour is not simply "up is green". */
  higherIsBetter: boolean;
  hint?: string;
};

/**
 * The KPI row, plus the funnel it was computed from.
 *
 * Returns `current` so callers do not recompute it — the dashboard needs both the
 * cards and the funnel, and calling funnel() again cost another 7 queries at ~280ms
 * round trip each.
 */
export async function kpis(days: number): Promise<{ cards: Kpi[]; current: Funnel; previous: Funnel }> {
  const { current, previous } = rangeFor(days);
  const [now, before] = await Promise.all([funnel(current), funnel(previous)]);

  const cards: Kpi[] = [
    { key: 'visitors', label: 'Visitors', value: now.visitors, previous: before.visitors, format: 'number', higherIsBetter: true },
    { key: 'leads', label: 'Leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'qualified', label: 'Qualified leads', value: now.qualified, previous: before.qualified, format: 'number', higherIsBetter: true },
    { key: 'opportunities', label: 'Opportunities', value: now.opportunities, previous: before.opportunities, format: 'number', higherIsBetter: true },
    { key: 'customers', label: 'New customers', value: now.customers, previous: before.customers, format: 'number', higherIsBetter: true },
    { key: 'revenue', label: 'Revenue', value: now.revenue, previous: before.revenue, format: 'money', higherIsBetter: true, hint: 'All revenue booked, including recurring' },
    { key: 'newRevenue', label: 'New business', value: now.newRevenue, previous: before.newRevenue, format: 'money', higherIsBetter: true, hint: 'Deals won in this period' },
    { key: 'spend', label: 'Marketing spend', value: now.spend, previous: before.spend, format: 'money', higherIsBetter: false },
    { key: 'cac', label: 'CAC', value: now.cac, previous: before.cac, format: 'money', higherIsBetter: false, hint: 'Spend per new customer' },
    { key: 'roas', label: 'ROAS', value: now.roas, previous: before.roas, format: 'ratio', higherIsBetter: true, hint: 'New business ÷ spend' },
  ];

  return { cards, current: now, previous: before };
}

export const kpiDelta = (k: Kpi) =>
  k.value === null || k.previous === null ? null : delta(k.value, k.previous);

/**
 * Daily or monthly series for the trend charts.
 *
 * Buckets are built in JS from one query per metric rather than grouped in SQL: the
 * date column is a DATE and grouping by month needs a cast that differs per driver,
 * and at 365 rows the cost is irrelevant.
 */
export async function trend(range: Range, bucket: 'day' | 'month') {
  const window = { gte: range.from, lte: range.to };

  const [sessionRows, leadRows, revenueRows, spendRows] = await Promise.all([
    db().metricSnapshot.findMany({
      where: { metricKey: 'sessions', date: window },
      select: { date: true, value: true },
    }),
    db().lead.findMany({ where: { createdAt: window }, select: { createdAt: true } }),
    db().revenueEntry.findMany({ where: { date: window }, select: { date: true, amount: true } }),
    db().marketingSpend.findMany({ where: { date: window }, select: { date: true, amount: true } }),
  ]);

  const key = (d: Date) =>
    bucket === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);

  const buckets = new Map<string, { date: string; visitors: number; leads: number; revenue: number; spend: number }>();
  const at = (d: Date) => {
    const k = key(d);
    let row = buckets.get(k);
    if (!row) {
      row = { date: k, visitors: 0, leads: 0, revenue: 0, spend: 0 };
      buckets.set(k, row);
    }
    return row;
  };

  for (const r of sessionRows) at(r.date).visitors += num(r.value);
  for (const r of leadRows) at(r.createdAt).leads += 1;
  for (const r of revenueRows) at(r.date).revenue += num(r.amount);
  for (const r of spendRows) at(r.date).spend += num(r.amount);

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Per-channel performance. Leads and revenue join through channelId, which every
 *  lead and revenue row carries, so this needs no walk up the funnel. */
export async function channelPerformance(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [channels, leadsByChannel, revenueByChannel, spendByCampaign, campaigns, customersByChannel] =
    await Promise.all([
      db().channel.findMany({ select: { id: true, name: true, kind: true } }),
      db().lead.groupBy({ by: ['channelId'], where: { createdAt: window }, _count: { _all: true } }),
      db().revenueEntry.groupBy({ by: ['channelId'], where: { date: window, kind: 'one_time' }, _sum: { amount: true } }),
      db().marketingSpend.groupBy({
        by: ['campaignId'],
        where: { date: window },
        _sum: { amount: true, clicks: true, impressions: true },
      }),
      db().campaign.findMany({ select: { id: true, channelId: true } }),
      db().customer.findMany({
        where: { wonAt: window },
        select: { opportunity: { select: { lead: { select: { channelId: true } } } } },
      }),
    ]);

  const campaignChannel = new Map(campaigns.map((c) => [c.id, c.channelId]));
  const spendByChannel = new Map<string, { spend: number; clicks: number; impressions: number }>();
  for (const row of spendByCampaign) {
    const channelId = campaignChannel.get(row.campaignId);
    if (!channelId) continue;
    const acc = spendByChannel.get(channelId) ?? { spend: 0, clicks: 0, impressions: 0 };
    acc.spend += num(row._sum.amount);
    acc.clicks += row._sum.clicks ?? 0;
    acc.impressions += row._sum.impressions ?? 0;
    spendByChannel.set(channelId, acc);
  }

  const customerCount = new Map<string, number>();
  for (const c of customersByChannel) {
    const channelId = c.opportunity?.lead?.channelId;
    if (!channelId) continue;
    customerCount.set(channelId, (customerCount.get(channelId) ?? 0) + 1);
  }

  const leadCount = new Map(leadsByChannel.map((r) => [r.channelId ?? '', r._count._all]));
  const revenueSum = new Map(revenueByChannel.map((r) => [r.channelId ?? '', num(r._sum.amount)]));

  return channels
    .map((ch) => {
      const spend = spendByChannel.get(ch.id) ?? { spend: 0, clicks: 0, impressions: 0 };
      const leads = leadCount.get(ch.id) ?? 0;
      const revenue = revenueSum.get(ch.id) ?? 0;
      const customers = customerCount.get(ch.id) ?? 0;
      return {
        id: ch.id,
        name: ch.name,
        kind: ch.kind,
        spend: spend.spend,
        clicks: spend.clicks,
        impressions: spend.impressions,
        leads,
        customers,
        revenue,
        ctr: rate(spend.clicks, spend.impressions),
        costPerLead: leads ? spend.spend / leads : null,
        cac: cac(spend.spend, customers),
        roas: roas(revenue, spend.spend),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
}

export type ChannelRow = Awaited<ReturnType<typeof channelPerformance>>[number];
