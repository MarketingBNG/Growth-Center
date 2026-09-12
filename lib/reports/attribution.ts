import { db } from '../prisma.ts';
import { int, sumByKey, type ReportContext, type Section } from './shared.ts';

export async function attribution({ current, money, inFx }: ReportContext): Promise<Section[]> {
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
  ) =>
    sumByKey(
      rows,
      keyOf,
      (row) => inFx(row._sum.amount, row.currency),
      (row) => (row as { _count?: { _all: number } })._count?._all ?? 0,
    );

  const channelRevenue = fold(byChannel, (r) => r.channelId ?? '');
  const campaignRevenue = fold(byCampaign, (r) => r.campaignId ?? '');
  const totalRevenue = channelRevenue.reduce((t, r) => t + r.amount, 0);

  return [
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
        int(r.count),
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
  ];
}
