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
        leads: leadCount,
        opportunities: oppBy.get(c.id) ?? 0,
        customers: customerCount,
        revenue: revenueSum,
        ctr: rate(clicks, impressions),
        clickToLead: rate(leadCount, clicks),
        costPerLead: costPer(amount, leadCount),
        cac: cac(amount, customerCount),
        roas: roas(revenueSum, amount),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);
}

export type CampaignRow = Awaited<ReturnType<typeof campaignPerformance>>[number];

/** Column totals for the marketing table's footer. Derived ratios are recomputed from
 *  the totals, never averaged from the rows — averaging ratios is how a footer ends up
 *  disagreeing with its own columns. */
export function campaignTotals(rows: CampaignRow[]) {
  const t = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      leads: acc.leads + r.leads,
      opportunities: acc.opportunities + r.opportunities,
      customers: acc.customers + r.customers,
      revenue: acc.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, opportunities: 0, customers: 0, revenue: 0 },
  );

  return {
    ...t,
    ctr: rate(t.clicks, t.impressions),
    clickToLead: rate(t.leads, t.clicks),
    costPerLead: costPer(t.spend, t.leads),
    cac: cac(t.spend, t.customers),
    roas: roas(t.revenue, t.spend),
  };
}
