import { db } from './prisma.ts';
import { cac, costPer, num, rate, roas } from './calc.ts';
import type { Kpi } from './kpi.ts';
import { DUPLICATE_MERGED_SUMMARY } from './leads.ts';

// The Kpi shape and its delta live in lib/kpi.ts so client components can use them
// without pulling the database in. Re-exported here because this is where callers
// already expect to find them.
export { kpiDelta } from './kpi.ts';
export type { Kpi } from './kpi.ts';

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

  const buckets = new Map<string, { date: string; visitors: number; leads: number; revenue: number; spend: number }>(
    emptyBuckets(range, bucket).map((k) => [
      k,
      { date: k, visitors: 0, leads: 0, revenue: 0, spend: 0 },
    ]),
  );
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

// ─── operational metrics for the per-module analytics band ────────────────────
//
// These live here rather than in the pages that show them so a figure appearing on two
// screens cannot disagree with itself. Every one returns null rather than 0 where there
// is no denominator, per the rule in lib/calc.ts.

/** An outbound touch. A status flip to `contacted` is not one — someone can change a
 *  dropdown without ever having contacted the lead. */
const CONTACT_TYPES = ['email', 'call', 'meeting'] as const;

/**
 * Median hours from a lead arriving to the first outbound touch, over leads created in
 * the period.
 *
 * Median rather than mean: one lead left for three weeks dragged the mean past every
 * individual response time, which made the number useless for spotting a bad week.
 *
 * Leads with no touch at all are EXCLUDED rather than counted as zero or as infinity —
 * they have no response time, and they are what the Unassigned card is for.
 */
export async function medianResponseHours(range: Range): Promise<number | null> {
  const window = { gte: range.from, lte: range.to };

  const [leads, touches] = await Promise.all([
    db().lead.findMany({ where: { createdAt: window }, select: { id: true, createdAt: true } }),
    db().activity.findMany({
      where: { type: { in: [...CONTACT_TYPES] }, lead: { createdAt: window } },
      select: { leadId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const first = new Map<string, Date>();
  for (const t of touches) {
    if (t.leadId && !first.has(t.leadId)) first.set(t.leadId, t.createdAt);
  }

  const hours: number[] = [];
  for (const l of leads) {
    const touched = first.get(l.id);
    if (!touched) continue;
    const h = (touched.getTime() - l.createdAt.getTime()) / 3_600_000;
    // A touch logged before the lead row is a clock or import artefact, not a negative
    // response time.
    if (h >= 0) hours.push(h);
  }

  if (!hours.length) return null;
  hours.sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/** Leads that arrived in the period and still have no owner. Period-scoped rather than
 *  an all-time backlog so it can be compared against the previous period like every
 *  other card in the band. */
export async function unassignedLeads(range: Range): Promise<number> {
  return db().lead.count({
    where: { createdAt: { gte: range.from, lte: range.to }, ownerEmail: null },
  });
}

/** Repeat submissions folded into an existing lead. Counted from the activity the merge
 *  writes, so it reflects what actually happened rather than a guess at overlap. */
export async function duplicatesMerged(range: Range): Promise<number> {
  return db().activity.count({
    where: {
      summary: DUPLICATE_MERGED_SUMMARY,
      createdAt: { gte: range.from, lte: range.to },
    },
  });
}

/**
 * Won ÷ decided, over deals that CLOSED in the period.
 *
 * Open deals are excluded from the denominator: counting them as not-yet-won drives the
 * rate toward zero on any period where the pipeline grew, which is the opposite of what
 * a growing pipeline means.
 */
export async function winRate(range: Range): Promise<number | null> {
  const closed = await db().opportunity.findMany({
    where: { closedAt: { gte: range.from, lte: range.to } },
    select: { stage: { select: { isWon: true, isLost: true } } },
  });

  let won = 0;
  let decided = 0;
  for (const o of closed) {
    if (o.stage.isWon) {
      won += 1;
      decided += 1;
    } else if (o.stage.isLost) {
      decided += 1;
    }
  }
  return rate(won, decided);
}

/** Mean days from a deal being created to being won, over deals won in the period. Lost
 *  deals are left out — an abandoned deal's "cycle" measures neglect, not sales speed. */
export async function avgCycleDays(range: Range): Promise<number | null> {
  const won = await db().opportunity.findMany({
    where: {
      closedAt: { gte: range.from, lte: range.to },
      stage: { isWon: true },
    },
    select: { createdAt: true, closedAt: true },
  });

  const spans = won
    .map((o) => (o.closedAt!.getTime() - o.createdAt.getTime()) / 86_400_000)
    .filter((d) => d >= 0);

  if (!spans.length) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

/** Leads per weekday for the band's bar chart. Indexed Monday-first, because a week that
 *  starts on Sunday puts the quietest two days at opposite ends of the chart. */
export async function leadsByWeekday(range: Range): Promise<{ label: string; value: number }[]> {
  const rows = await db().lead.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true },
  });

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const counts = new Array(7).fill(0) as number[];
  for (const r of rows) {
    // getUTCDay() is 0=Sunday; shift so Monday is 0.
    counts[(r.createdAt.getUTCDay() + 6) % 7] += 1;
  }
  return labels.map((label, i) => ({ label, value: counts[i] }));
}

/** Companies, contacts and the average revenue booked per paying account. */
export async function accountMetrics(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [companies, contacts, customers, revenueRows] = await Promise.all([
    db().company.count({ where: { createdAt: window } }),
    db().contact.count({ where: { createdAt: window } }),
    db().customer.count({ where: { wonAt: window } }),
    db().revenueEntry.findMany({
      where: { date: window },
      select: { customerId: true, amount: true },
    }),
  ]);

  // Averaged over accounts that actually billed in the period, not over every customer
  // on the books — dividing by dormant accounts understates what an active one is worth.
  const perCustomer = new Map<string, number>();
  for (const r of revenueRows) {
    perCustomer.set(r.customerId, (perCustomer.get(r.customerId) ?? 0) + num(r.amount));
  }
  const totals = [...perCustomer.values()];
  const avgAccountValue = totals.length
    ? totals.reduce((a, b) => a + b, 0) / totals.length
    : null;

  return { companies, contacts, customers, avgAccountValue, payingAccounts: totals.length };
}

/** Share of all companies on the books that are customers. A snapshot, so it ignores the
 *  date range — a company won last year is still a customer today. */
export async function customerShare(): Promise<number | null> {
  const [companies, customers] = await Promise.all([
    db().company.count(),
    db().customer.count({ where: { churnedAt: null } }),
  ]);
  return rate(customers, companies);
}

/**
 * Spend against the budget of the campaigns that were actually live in the period.
 *
 * Only overlapping campaigns count toward the denominator. Summing every budget on the
 * books against one period's spend compared a month of spend to years of budget and
 * reported single-digit pacing on a campaign that had already overspent; the reverse —
 * a long period against a handful of budgets — read as 185%.
 *
 * Null when no live campaign carries a budget: pacing against nothing is not 0%.
 */
export async function budgetPacing(range: Range): Promise<number | null> {
  const window = { gte: range.from, lte: range.to };

  const [spendAgg, budgetRows] = await Promise.all([
    db().marketingSpend.aggregate({ where: { date: window }, _sum: { amount: true } }),
    db().campaign.findMany({
      where: {
        budget: { not: null },
        // Overlap, treating an open-ended campaign as still running.
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: range.to } }] },
          { OR: [{ endDate: null }, { endDate: { gte: range.from } }] },
        ],
      },
      select: { budget: true },
    }),
  ]);

  const budget = budgetRows.reduce((sum, c) => sum + num(c.budget), 0);
  return rate(num(spendAgg._sum.amount), budget);
}

// ─── per-screen KPI sets ──────────────────────────────────────────────────────
//
// One builder per module screen, so the band is fed from here rather than from figures
// assembled in a page. Each returns the cards plus whatever the page also needs, to
// avoid a second round of the same queries.

/** Leads: New leads · Qualified · Cost per lead · Median response · Unassigned. */
export async function leadsKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [now, before, medianNow, medianBefore, unassignedNow, unassignedBefore, weekday] =
    await Promise.all([
      funnel(current),
      funnel(previous),
      medianResponseHours(current),
      medianResponseHours(previous),
      unassignedLeads(current),
      unassignedLeads(previous),
      leadsByWeekday(current),
    ]);

  const cards: Kpi[] = [
    { key: 'leads', label: 'New leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'qualified', label: 'Qualified', value: now.qualified, previous: before.qualified, format: 'number', higherIsBetter: true },
    { key: 'cpl', label: 'Cost per lead', value: costPer(now.spend, now.leads), previous: costPer(before.spend, before.leads), format: 'money', higherIsBetter: false },
    { key: 'response', label: 'Median response', value: medianNow, previous: medianBefore, format: 'duration', higherIsBetter: false, hint: 'First outbound touch; untouched leads excluded' },
    { key: 'unassigned', label: 'Unassigned', value: unassignedNow, previous: unassignedBefore, format: 'number', higherIsBetter: false },
  ];

  return { cards, current: now, weekday, qualificationRate: now.leadToQualified };
}

/** CRM: Companies · Contacts · Customers · Avg account value · Duplicates merged. */
export async function crmKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [now, before, dupNow, dupBefore, share, weekday] = await Promise.all([
    accountMetrics(current),
    accountMetrics(previous),
    duplicatesMerged(current),
    duplicatesMerged(previous),
    customerShare(),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'companies', label: 'Companies', value: now.companies, previous: before.companies, format: 'number', higherIsBetter: true },
    { key: 'contacts', label: 'Contacts', value: now.contacts, previous: before.contacts, format: 'number', higherIsBetter: true },
    { key: 'customers', label: 'Customers', value: now.customers, previous: before.customers, format: 'number', higherIsBetter: true },
    { key: 'avgAccount', label: 'Avg account value', value: now.avgAccountValue, previous: before.avgAccountValue, format: 'money', higherIsBetter: true, hint: 'Averaged over accounts that billed this period' },
    { key: 'duplicates', label: 'Duplicates merged', value: dupNow, previous: dupBefore, format: 'number', higherIsBetter: true, hint: 'Repeat submissions folded into an existing lead' },
  ];

  return { cards, customerShare: share, weekday };
}

/** Pipeline: Open deals · Total value · Weighted · Win rate · Avg cycle.
 *
 *  The first three are snapshots with no previous period — a pipeline is a standing
 *  balance, not a flow — so their delta renders as "No prior period" rather than a
 *  fabricated comparison. */
export async function pipelineKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [open, rateNow, ratePrev, cycleNow, cyclePrev, weekday] = await Promise.all([
    openPipeline(),
    winRate(current),
    winRate(previous),
    avgCycleDays(current),
    avgCycleDays(previous),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'openDeals', label: 'Open deals', value: open.count, previous: null, format: 'number', higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    { key: 'totalValue', label: 'Total value', value: open.total, previous: null, format: 'money', higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    { key: 'weighted', label: 'Weighted', value: open.weighted, previous: null, format: 'money', higherIsBetter: true, hint: 'Value × probability' },
    { key: 'winRate', label: 'Win rate', value: rateNow, previous: ratePrev, format: 'percent', higherIsBetter: true, hint: 'Won ÷ decided, over deals closed this period' },
    { key: 'cycle', label: 'Avg cycle', value: cycleNow, previous: cyclePrev, format: 'days', higherIsBetter: false, hint: 'Created to won, for deals won this period' },
  ];

  return { cards, open, winRate: rateNow, weekday };
}

/** Marketing: Spend · Leads · CPL · ROAS · CAC. */
export async function marketingKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [now, before, pacing, weekday] = await Promise.all([
    funnel(current),
    funnel(previous),
    budgetPacing(current),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'spend', label: 'Spend', value: now.spend, previous: before.spend, format: 'money', higherIsBetter: false },
    { key: 'leads', label: 'Leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'cpl', label: 'CPL', value: costPer(now.spend, now.leads), previous: costPer(before.spend, before.leads), format: 'money', higherIsBetter: false },
    { key: 'roas', label: 'ROAS', value: now.roas, previous: before.roas, format: 'ratio', higherIsBetter: true, hint: 'New business ÷ spend' },
    { key: 'cac', label: 'CAC', value: now.cac, previous: before.cac, format: 'money', higherIsBetter: false, hint: 'Spend per new customer' },
  ];

  return { cards, current: now, budgetPacing: pacing, weekday };
}

/** Analytics: Sessions · Visitor→lead · Lead→qualified · Opp→customer · Revenue. */
export async function analyticsKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [now, before, weekday] = await Promise.all([
    funnel(current),
    funnel(previous),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'sessions', label: 'Sessions', value: now.visitors, previous: before.visitors, format: 'number', higherIsBetter: true },
    { key: 'visitorToLead', label: 'Visitor→lead', value: now.visitorToLead, previous: before.visitorToLead, format: 'percent', higherIsBetter: true },
    { key: 'leadToQualified', label: 'Lead→qualified', value: now.leadToQualified, previous: before.leadToQualified, format: 'percent', higherIsBetter: true },
    { key: 'oppToCustomer', label: 'Opp→customer', value: now.opportunityToCustomer, previous: before.opportunityToCustomer, format: 'percent', higherIsBetter: true },
    { key: 'revenue', label: 'Revenue', value: now.revenue, previous: before.revenue, format: 'money', higherIsBetter: true },
  ];

  return { cards, current: now, weekday };
}

// ─── per-screen trend series ──────────────────────────────────────────────────
//
// Bucketed the same way as trend(): one query, grouped in JS, because the date columns
// are DATE and a per-driver cast is not worth it at 365 rows.

function bucketKey(d: Date, bucket: 'day' | 'month') {
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
function emptyBuckets(range: Range, bucket: 'day' | 'month'): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor <= range.to) {
    keys.push(bucketKey(cursor, bucket));
    if (bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // A month bucket can repeat when the range starts mid-month.
  return [...new Set(keys)];
}

/** Companies and contacts created per bucket — what the CRM screen's "Accounts added"
 *  chart draws. Counted together because the screen treats them as one population. */
export async function accountsTrend(range: Range, bucket: 'day' | 'month') {
  const window = { gte: range.from, lte: range.to };

  const [companies, contacts] = await Promise.all([
    db().company.findMany({ where: { createdAt: window }, select: { createdAt: true } }),
    db().contact.findMany({ where: { createdAt: window }, select: { createdAt: true } }),
  ]);

  const buckets = new Map<string, { date: string; accounts: number }>(
    emptyBuckets(range, bucket).map((k) => [k, { date: k, accounts: 0 }]),
  );
  const at = (d: Date) => {
    const k = bucketKey(d, bucket);
    let row = buckets.get(k);
    if (!row) {
      row = { date: k, accounts: 0 };
      buckets.set(k, row);
    }
    return row;
  };

  for (const c of companies) at(c.createdAt).accounts += 1;
  for (const c of contacts) at(c.createdAt).accounts += 1;

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Deal value created per bucket, by the date the opportunity was opened — "pipeline
 *  created", not pipeline closed. */
export async function pipelineTrend(range: Range, bucket: 'day' | 'month') {
  const rows = await db().opportunity.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true, value: true },
  });

  const buckets = new Map<string, { date: string; created: number }>(
    emptyBuckets(range, bucket).map((k) => [k, { date: k, created: 0 }]),
  );
  for (const r of rows) {
    const k = bucketKey(r.createdAt, bucket);
    const row = buckets.get(k) ?? { date: k, created: 0 };
    row.created += num(r.value);
    buckets.set(k, row);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Share of customers who have billed more than once. A snapshot: it asks whether an
 *  account came back at all, which no single period can answer. */
export async function repeatCustomerRate(): Promise<number | null> {
  const rows = await db().revenueEntry.groupBy({
    by: ['customerId'],
    _count: { _all: true },
  });
  if (!rows.length) return null;
  const repeat = rows.filter((r) => r._count._all > 1).length;
  return rate(repeat, rows.length);
}
