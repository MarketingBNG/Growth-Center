import { db } from '../platform/prisma.ts';
import { leadSourceLabel } from '../integrations/crm-mapping.ts';
import { int, type ReportContext, type Section } from './shared.ts';

export async function leads({ current }: ReportContext): Promise<Section[]> {
  const window = { gte: current.from, lte: current.to };
  const [byStatus, bySource, byOwner, total, qualified] = await Promise.all([
    db().lead.groupBy({ by: ['status'], where: { createdAt: window }, _count: { _all: true } }),
    // By the CRM's own source, not the SourceType enum. Grouped by the enum, this table
    // reported "social 17,989" — one row for Facebook, Instagram, LinkedIn and WhatsApp
    // together — while every other screen in the app named the four separately.
    db().lead.groupBy({ by: ['sourceDetail'], where: { createdAt: window }, _count: { _all: true } }),
    db().lead.groupBy({ by: ['ownerEmail'], where: { createdAt: window }, _count: { _all: true } }),
    db().lead.count({ where: { createdAt: window } }),
    db().lead.count({ where: { createdAt: window, qualifiedAt: { not: null } } }),
  ]);
  return [
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
      // Folded onto the same groups the Leads page filters by, busiest first, so a
      // report and the screen it came from cannot disagree about how many leads
      // Facebook produced.
      rows: [...bySource
        .reduce((acc, r) => {
          const label = leadSourceLabel(r.sourceDetail);
          return acc.set(label, (acc.get(label) ?? 0) + r._count._all);
        }, new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => [label, int(n)]),
    },
    {
      kind: 'table',
      title: 'By owner',
      columns: ['Owner', 'Leads'],
      align: ['left', 'right'],
      rows: byOwner.map((r) => [r.ownerEmail ?? 'Unassigned', int(r._count._all)]),
    },
  ];
}
