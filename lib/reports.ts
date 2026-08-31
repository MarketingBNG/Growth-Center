import { db } from './prisma.ts';
import { OPEN_DEAL } from './pipeline.ts';
import { convert, symbolOf, type CurrencySettings } from './currency.ts';
import { currencySettings } from './settings.ts';
import { channelPerformance, funnel, openPipeline, rangeFor, type Range } from './metrics.ts';
import { campaignPerformance, campaignTotals } from './campaigns.ts';

// Reports are compositions of the SAME functions the pages use. Nothing here recomputes
// a metric its own way, which is what stops an exported report from disagreeing with the
// dashboard it was run from.

export const REPORTS = [
  {
    id: 'executive',
    name: 'Executive growth report',
    description: 'The funnel, revenue against spend, and where growth came from.',
  },
  {
    id: 'marketing',
    name: 'Marketing report',
    description: 'Campaign and channel performance with CAC and ROAS.',
  },
  {
    id: 'leads',
    name: 'Lead report',
    description: 'Volume, sources and qualification, plus who owns what.',
  },
  {
    id: 'sales',
    name: 'Sales report',
    description: 'Pipeline by stage, deals won and lost, and revenue booked.',
  },
  {
    id: 'attribution',
    name: 'Revenue attribution',
    description: 'Revenue traced back to the channel and campaign that produced it.',
  },
] as const;

export type ReportId = (typeof REPORTS)[number]['id'];
export const isReportId = (v: string): v is ReportId => REPORTS.some((r) => r.id === v);

export type Section =
  | { kind: 'stats'; title: string; rows: { label: string; value: string; hint?: string }[] }
  | { kind: 'table'; title: string; columns: string[]; align?: ('left' | 'right')[]; rows: string[][] }
  | { kind: 'note'; title: string; body: string };

export type Report = { id: ReportId; name: string; range: Range; sections: Section[] };

/** The reporting currency's symbol, not a dollar sign: this workspace reports in rupees
 *  and its ad spend is billed in them. */
const moneyIn = (settings: CurrencySettings) => (n: number) =>
  `${symbolOf(settings.reporting)}${Math.round(n).toLocaleString('en-US')}`;
const int = (n: number) => n.toLocaleString('en-US');
const pct = (n: number | null, d = 1) => (n === null ? '—' : `${n.toFixed(d)}%`);
const ratio = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)}×`);

export async function buildReport(id: ReportId, days: number): Promise<Report> {
  const { current, previous } = rangeFor(days);
  const name = REPORTS.find((r) => r.id === id)!.name;
  const base = { id, name, range: current };

  // Deals and revenue here are written in more than one currency, so every figure below
  // converts before it adds. Summed flat, 143 rupee deals were counted as dollars.
  const fx = await currencySettings();
  const money = moneyIn(fx);
  const inFx = (amount: unknown, currency: string | null) =>
    convert(Number(amount ?? 0), currency, fx) ?? 0;

  if (id === 'executive') {
    const [now, before, pipeline, channels] = await Promise.all([
      funnel(current),
      funnel(previous),
      openPipeline(),
      channelPerformance(current),
    ]);
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Funnel',
          rows: [
            { label: 'Visitors', value: int(now.visitors) },
            { label: 'Leads', value: int(now.leads), hint: `${pct(now.visitorToLead, 2)} of visitors` },
            { label: 'Qualified leads', value: int(now.qualified), hint: `${pct(now.leadToQualified)} of leads` },
            { label: 'Opportunities', value: int(now.opportunities) },
            { label: 'New customers', value: int(now.customers), hint: `${pct(now.opportunityToCustomer)} of opportunities` },
          ],
        },
        {
          kind: 'stats',
          title: 'Money',
          rows: [
            { label: 'Revenue', value: money(now.revenue), hint: `all bookings; ${money(before.revenue)} previous period` },
            { label: 'New business', value: money(now.newRevenue), hint: 'deals won in this period' },
            { label: 'Marketing spend', value: money(now.spend), hint: `${money(before.spend)} previous period` },
            { label: 'CAC', value: now.cac === null ? '—' : money(now.cac) },
            { label: 'ROAS', value: ratio(now.roas) },
            { label: 'Open pipeline', value: money(pipeline.total), hint: `${money(pipeline.weighted)} weighted` },
          ],
        },
        {
          kind: 'table',
          title: 'Channels',
          columns: ['Channel', 'Spend', 'Leads', 'Customers', 'New revenue', 'ROAS'],
          align: ['left', 'right', 'right', 'right', 'right', 'right'],
          rows: channels.map((c) => [c.name, money(c.spend), int(c.leads), int(c.customers), money(c.revenue), ratio(c.roas)]),
        },
      ],
    };
  }

  if (id === 'marketing') {
    const rows = await campaignPerformance(current);
    const totals = campaignTotals(rows);
    const active = rows.filter((r) => r.spend > 0 || r.leads > 0);
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Totals',
          rows: [
            { label: 'Spend', value: money(totals.spend) },
            { label: 'Impressions', value: int(totals.impressions) },
            { label: 'Clicks', value: int(totals.clicks), hint: `${pct(totals.ctr, 2)} CTR` },
            { label: 'Leads', value: int(totals.leads), hint: totals.costPerLead === null ? undefined : `${money(totals.costPerLead)} per lead` },
            { label: 'Revenue', value: money(totals.revenue), hint: `${ratio(totals.roas)} ROAS` },
          ],
        },
        {
          kind: 'table',
          title: 'Campaigns',
          columns: ['Campaign', 'Channel', 'Spend', 'Clicks', 'CTR', 'Leads', 'CPL', 'New revenue', 'ROAS'],
          align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
          rows: active.map((c) => [
            c.name, c.channelName, money(c.spend), int(c.clicks), pct(c.ctr, 2),
            int(c.leads), c.costPerLead === null ? '—' : money(c.costPerLead),
            money(c.revenue), ratio(c.roas),
          ]),
        },
      ],
    };
  }

  if (id === 'leads') {
    const window = { gte: current.from, lte: current.to };
    const [byStatus, bySource, byOwner, total, qualified] = await Promise.all([
      db().lead.groupBy({ by: ['status'], where: { createdAt: window }, _count: { _all: true } }),
      db().lead.groupBy({ by: ['sourceType'], where: { createdAt: window }, _count: { _all: true } }),
      db().lead.groupBy({ by: ['ownerEmail'], where: { createdAt: window }, _count: { _all: true } }),
      db().lead.count({ where: { createdAt: window } }),
      db().lead.count({ where: { createdAt: window, qualifiedAt: { not: null } } }),
    ]);
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Volume',
          rows: [
            { label: 'Leads created', value: int(total) },
            { label: 'Reached qualified', value: int(qualified), hint: total ? `${((qualified / total) * 100).toFixed(1)}% of new leads` : undefined },
          ],
        },
        {
          kind: 'table',
          title: 'By status',
          columns: ['Status', 'Leads', 'Share'],
          align: ['left', 'right', 'right'],
          rows: byStatus.map((r) => [r.status, int(r._count._all), total ? `${((r._count._all / total) * 100).toFixed(1)}%` : '—']),
        },
        {
          kind: 'table',
          title: 'By source',
          columns: ['Source', 'Leads'],
          align: ['left', 'right'],
          rows: bySource.map((r) => [r.sourceType.replaceAll('_', ' '), int(r._count._all)]),
        },
        {
          kind: 'table',
          title: 'By owner',
          columns: ['Owner', 'Leads'],
          align: ['left', 'right'],
          rows: byOwner.map((r) => [r.ownerEmail ?? 'Unassigned', int(r._count._all)]),
        },
      ],
    };
  }

  if (id === 'sales') {
    const window = { gte: current.from, lte: current.to };
    const [stages, won, lost, revenue, pipeline] = await Promise.all([
      db().pipelineStage.findMany({
        orderBy: { position: 'asc' },
        include: { opportunities: { where: OPEN_DEAL, select: { value: true, probability: true, currency: true } } },
      }),
      db().opportunity.findMany({ where: { closedAt: window, stage: { isWon: true } }, select: { value: true, currency: true } }),
      db().opportunity.findMany({ where: { closedAt: window, stage: { isLost: true } }, select: { value: true, currency: true, lostReason: true } }),
      db().revenueEntry.groupBy({ by: ['currency'], where: { date: window }, _sum: { amount: true } }),
      openPipeline(),
    ]);

    const lostReasons = lost.reduce<Record<string, number>>((acc, o) => {
      const key = o.lostReason ?? 'Not recorded';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Closed in period',
          rows: [
            { label: 'Won', value: int(won.length), hint: money(won.reduce((t, o) => t + inFx(o.value, o.currency), 0)) },
            { label: 'Lost', value: int(lost.length), hint: money(lost.reduce((t, o) => t + inFx(o.value, o.currency), 0)) },
            { label: 'Win rate', value: won.length + lost.length ? `${((won.length / (won.length + lost.length)) * 100).toFixed(0)}%` : '—' },
            { label: 'Revenue booked', value: money(revenue.reduce((t, r) => t + inFx(r._sum.amount, r.currency), 0)) },
            { label: 'Open pipeline', value: money(pipeline.total), hint: `${money(pipeline.weighted)} weighted` },
          ],
        },
        {
          kind: 'table',
          title: 'Open pipeline by stage',
          columns: ['Stage', 'Deals', 'Value', 'Weighted'],
          align: ['left', 'right', 'right', 'right'],
          rows: stages
            .filter((s) => !s.isWon && !s.isLost)
            .map((s) => {
              const value = s.opportunities.reduce((t, o) => t + inFx(o.value, o.currency), 0);
              const weighted = s.opportunities.reduce(
                (t, o) => t + (inFx(o.value, o.currency) * o.probability) / 100,
                0,
              );
              return [s.name, int(s.opportunities.length), money(value), money(weighted)];
            }),
        },
        {
          kind: 'table',
          title: 'Why deals were lost',
          columns: ['Reason', 'Deals'],
          align: ['left', 'right'],
          rows: Object.entries(lostReasons).map(([reason, count]) => [reason, int(count)]),
        },
      ],
    };
  }

  // attribution
  const window = { gte: current.from, lte: current.to };
  const [byChannel, byCampaign, direct] = await Promise.all([
    db().revenueEntry.groupBy({ by: ['channelId', 'currency'], where: { date: window }, _sum: { amount: true }, _count: { _all: true } }),
    db().revenueEntry.groupBy({ by: ['campaignId', 'currency'], where: { date: window }, _sum: { amount: true } }),
    db().revenueEntry.groupBy({ by: ['currency'], where: { date: window, channelId: null }, _sum: { amount: true } }),
  ]);

  const [channels, campaigns] = await Promise.all([
    db().channel.findMany({ select: { id: true, name: true } }),
    db().campaign.findMany({ select: { id: true, name: true } }),
  ]);
  const channelName = new Map(channels.map((c) => [c.id, c.name]));
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  // Grouping by currency splits each channel and campaign into a row per currency, so
  // they are folded back once every amount is in the reporting one. Without this a
  // channel that billed in both would appear twice and its share would be halved.
  const fold = <T extends { _sum: { amount: unknown }; currency: string | null }>(
    rows: T[],
    keyOf: (row: T) => string,
  ) => {
    const out = new Map<string, { key: string; amount: number; entries: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const acc = out.get(key) ?? { key, amount: 0, entries: 0 };
      acc.amount += inFx(row._sum.amount, row.currency);
      acc.entries += (row as { _count?: { _all: number } })._count?._all ?? 0;
      out.set(key, acc);
    }
    return [...out.values()].sort((a, b) => b.amount - a.amount);
  };

  const channelRevenue = fold(byChannel, (r) => r.channelId ?? '');
  const campaignRevenue = fold(byCampaign, (r) => r.campaignId ?? '');
  const totalRevenue = channelRevenue.reduce((t, r) => t + r.amount, 0);

  return {
    ...base,
    sections: [
      {
        kind: 'note',
        title: 'How this is attributed',
        body: 'Every revenue row carries the channel and campaign of the lead that produced it, captured at conversion. Revenue with no channel came from a deal created directly, without an originating lead.',
      },
      {
        kind: 'table',
        title: 'Revenue by channel',
        columns: ['Channel', 'Entries', 'Revenue', 'Share'],
        align: ['left', 'right', 'right', 'right'],
        rows: channelRevenue.map((r) => [
          r.key ? (channelName.get(r.key) ?? 'Unknown') : 'No channel recorded',
          int(r.entries),
          money(r.amount),
          totalRevenue ? `${((r.amount / totalRevenue) * 100).toFixed(1)}%` : '—',
        ]),
      },
      {
        kind: 'table',
        title: 'Revenue by campaign',
        columns: ['Campaign', 'Revenue'],
        align: ['left', 'right'],
        rows: campaignRevenue
          .filter((r) => r.amount > 0)
          .map((r) => [
            r.key ? (campaignName.get(r.key) ?? 'Unknown') : 'No campaign recorded',
            money(r.amount),
          ]),
      },
      {
        kind: 'stats',
        title: 'Unattributed',
        rows: [
          {
            label: 'Revenue with no channel',
            value: money(direct.reduce((t, r) => t + inFx(r._sum.amount, r.currency), 0)),
          },
        ],
      },
    ],
  };
}
