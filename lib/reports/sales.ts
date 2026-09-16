import { db } from '../platform/prisma.ts';
import { OPEN_DEAL } from '../pipeline/pipeline.ts';
import { openPipeline } from '../metrics.ts';
import { int, type ReportContext, type Section } from './shared.ts';

export async function sales({ current, money, inFx }: ReportContext): Promise<Section[]> {
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

  return [
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
  ];
}
