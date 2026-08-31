import { db } from './prisma.ts';
import { cac, costPer, num, rate, roas } from './calc.ts';
import { convert } from './currency.ts';
import { currencySettings } from './settings.ts';
import type { Range } from './metrics.ts';

/**
 * Campaign performance. Marketing, Paid Ads and the dashboard's campaign table all
 * read this one function, so CTR, CAC and ROAS cannot differ between them.
 *
 * Spend comes from MarketingSpend rows rather than Campaign.budget: a budget is an
 * intention, and reporting it as cost would overstate ROAS on every under-spending
 * campaign.
 */
export async function campaignPerformance(range: Range, channelId?: string) {
  const window = { gte: range.from, lte: range.to };

  const campaigns = await db().campaign.findMany({
    where: channelId ? { channelId } : undefined,
    select: {
      id: true,
      name: true,
      status: true,
      source: true,
      channel: { select: { id: true, name: true, kind: true } },
    },
    orderBy: { name: 'asc' },
  });
  if (campaigns.length === 0) return [];

  const ids = campaigns.map((c) => c.id);

  const [spend, leads, opportunities, revenue, customers] = await Promise.all([
    // Grouped by currency as well: spend here is billed in rupees and most revenue is
    // written in dollars, so a per-campaign ROAS that divides one by the other is wrong
    // by the exchange rate and looks entirely plausible.
    db().marketingSpend.groupBy({
      by: ['campaignId', 'currency'],
      where: { campaignId: { in: ids }, date: window },
      _sum: { amount: true, clicks: true, impressions: true },
    }),
    db().lead.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, createdAt: window },
      _count: { _all: true },
    }),
    db().opportunity.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, createdAt: window },
      _count: { _all: true },
    }),
    // one_time only: recurring income from a customer won last year is not a return on
    // this period's campaign spend.
    db().revenueEntry.groupBy({
      by: ['campaignId', 'currency'],
      where: { campaignId: { in: ids }, date: window, kind: 'one_time' },
      _sum: { amount: true },
    }),
    // Counted in SQL like its four siblings. This used to load every customer won in
    // the window — unfiltered by campaign — and tally them in a Map, which is a table
    // scan plus a join per row to produce a number Postgres can return on its own.
    // Customer.opportunityId is unique, so one matching opportunity is one customer.
    db().opportunity.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, customer: { is: { wonAt: window } } },
      _count: { _all: true },
    }),
  ]);

  const fx = await currencySettings();

  // Whether anything in the workspace is attributed to a campaign at all.
  //
  // Zoho carries no campaign key on a lead, deal or payment — Campaign_Source is null on
  // every record — so these columns cannot be computed for any campaign, ever, from the
  // data this app receives. Reported as 0 they read as "this campaign produced nothing",
  // which is a claim about the campaign; the truth is that nothing measured it. Same rule
  // lib/calc.ts already applies to cost: unknown is never zero.
  const [anyLead, anyOpportunity, anyRevenue] = await Promise.all([
    db().lead.findFirst({ where: { campaignId: { not: null } }, select: { id: true } }),
    db().opportunity.findFirst({ where: { campaignId: { not: null } }, select: { id: true } }),
    db().revenueEntry.findFirst({ where: { campaignId: { not: null } }, select: { id: true } }),
  ]);
  const tracked = {
    leads: anyLead !== null,
    opportunities: anyOpportunity !== null,
    revenue: anyRevenue !== null,
  };

  // Folded back per campaign once every amount is in the reporting currency. A campaign
  // billed in two currencies would otherwise appear twice.
  const spendBy = new Map<string, { amount: number; clicks: number; impressions: number }>();
  for (const r of spend) {
    const acc = spendBy.get(r.campaignId) ?? { amount: 0, clicks: 0, impressions: 0 };
    acc.amount += convert(num(r._sum.amount), r.currency, fx) ?? 0;
    acc.clicks += r._sum.clicks ?? 0;
    acc.impressions += r._sum.impressions ?? 0;
    spendBy.set(r.campaignId, acc);
  }

  const leadBy = new Map(leads.map((r) => [r.campaignId ?? '', r._count._all]));
  const oppBy = new Map(opportunities.map((r) => [r.campaignId ?? '', r._count._all]));

  const revenueBy = new Map<string, number>();
  for (const r of revenue) {
    const key = r.campaignId ?? '';
    revenueBy.set(key, (revenueBy.get(key) ?? 0) + (convert(num(r._sum.amount), r.currency, fx) ?? 0));
  }

  const customerBy = new Map(customers.map((r) => [r.campaignId ?? '', r._count._all]));

  return campaigns
    .map((c) => {
      const s = spendBy.get(c.id);
      const amount = s?.amount ?? 0;
      const clicks = s?.clicks ?? 0;
      const impressions = s?.impressions ?? 0;
      const leadCount = leadBy.get(c.id) ?? 0;
      const customerCount = customerBy.get(c.id) ?? 0;
      const revenueSum = revenueBy.get(c.id) ?? 0;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        source: c.source,
        channelId: c.channel.id,
        channelName: c.channel.name,
        channelKind: c.channel.kind,
        spend: amount,
        impressions,
        clicks,
        // Null, not 0, wherever nothing links that entity to a campaign — and every
        // figure derived from it goes null with it rather than dividing by a count that
        // only means "unmeasured".
        leads: tracked.leads ? leadCount : null,
        opportunities: tracked.opportunities ? (oppBy.get(c.id) ?? 0) : null,
        customers: tracked.opportunities ? customerCount : null,
        revenue: tracked.revenue ? revenueSum : null,
        ctr: rate(clicks, impressions),
        clickToLead: tracked.leads ? rate(leadCount, clicks) : null,
        costPerLead: tracked.leads ? costPer(amount, leadCount) : null,
        cac: tracked.opportunities ? cac(amount, customerCount) : null,
        roas: tracked.revenue ? roas(revenueSum, amount) : null,
      };
    })
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.spend - a.spend);
}

export type CampaignRow = Awaited<ReturnType<typeof campaignPerformance>>[number];

/** Column totals for the marketing table's footer. Derived ratios are recomputed from
 *  the totals, never averaged from the rows — averaging ratios is how a footer ends up
 *  disagreeing with its own columns. */
export function campaignTotals(rows: CampaignRow[]) {
  // An untracked column stays untracked in the footer. Summed with `?? 0` it would come
  // back as a confident 0 under a column of dashes, which is the disagreement this
  // footer's ratios are already recomputed to avoid.
  const sum = (pick: (r: CampaignRow) => number | null): number | null =>
    rows.some((r) => pick(r) === null)
      ? null
      : rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

  const t = {
    spend: rows.reduce((acc, r) => acc + r.spend, 0),
    impressions: rows.reduce((acc, r) => acc + r.impressions, 0),
    clicks: rows.reduce((acc, r) => acc + r.clicks, 0),
    leads: sum((r) => r.leads),
    opportunities: sum((r) => r.opportunities),
    customers: sum((r) => r.customers),
    revenue: sum((r) => r.revenue),
  };

  return {
    ...t,
    ctr: rate(t.clicks, t.impressions),
    clickToLead: t.leads === null ? null : rate(t.leads, t.clicks),
    costPerLead: t.leads === null ? null : costPer(t.spend, t.leads),
    cac: t.customers === null ? null : cac(t.spend, t.customers),
    roas: t.revenue === null ? null : roas(t.revenue, t.spend),
  };
}
