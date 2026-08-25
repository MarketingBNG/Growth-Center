import { db } from './prisma.ts';
import { cac, num, rate, roas } from './calc.ts';
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
    db().marketingSpend.groupBy({
      by: ['campaignId'],
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
    db().revenueEntry.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, date: window },
      _sum: { amount: true },
    }),
    db().customer.findMany({
      where: { wonAt: window },
      select: { opportunity: { select: { campaignId: true } } },
    }),
  ]);

  const spendBy = new Map(spend.map((r) => [r.campaignId, r]));
  const leadBy = new Map(leads.map((r) => [r.campaignId ?? '', r._count._all]));
  const oppBy = new Map(opportunities.map((r) => [r.campaignId ?? '', r._count._all]));
  const revenueBy = new Map(revenue.map((r) => [r.campaignId ?? '', num(r._sum.amount)]));

  const customerBy = new Map<string, number>();
  for (const c of customers) {
    const id = c.opportunity?.campaignId;
    if (!id) continue;
    customerBy.set(id, (customerBy.get(id) ?? 0) + 1);
  }

  return campaigns
    .map((c) => {
      const s = spendBy.get(c.id);
      const amount = num(s?._sum.amount);
      const clicks = s?._sum.clicks ?? 0;
      const impressions = s?._sum.impressions ?? 0;
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
        costPerLead: leadCount ? amount / leadCount : null,
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
    costPerLead: t.leads ? t.spend / t.leads : null,
    cac: cac(t.spend, t.customers),
    roas: roas(t.revenue, t.spend),
  };
}
