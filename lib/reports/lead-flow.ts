import { db } from '../platform/prisma.ts';
import { fairShare } from '../shared/calc.ts';
import { int, pct, type ReportContext, type Section } from './shared.ts';

export async function leadFlow({ current }: ReportContext): Promise<Section[]> {
  // "So that everyone gets a fair lead flow every day. That should be the target in the
  // process." — the Sep 2 review. This is that target, measured.
  //
  // Read-only, and deliberately. Every one of this workspace's 27,401 leads arrives from
  // Zoho with an owner already on it — nothing is created here — so round-robin
  // assignment in this app would have nothing to assign and would fight the sync for the
  // records it does touch. The lever is Zoho's own assignment rules; what was missing was
  // any way to see whether they are landing evenly.
  const rows = await db().lead.findMany({
    where: { createdAt: { gte: current.from, lte: current.to } },
    select: { ownerEmail: true, createdAt: true },
  });

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Set(rows.map((r) => iso(r.createdAt)));
  const byOwner = new Map<string, { n: number; days: Set<string> }>();
  for (const r of rows) {
    const key = r.ownerEmail ?? 'Unassigned';
    const acc = byOwner.get(key) ?? { n: 0, days: new Set<string>() };
    acc.n += 1;
    acc.days.add(iso(r.createdAt));
    byOwner.set(key, acc);
  }

  // The target is an even split across everyone who took a lead, over the days leads
  // arrived — not across the calendar, which would read every quiet weekend as a
  // shortfall, and not across the whole roster, most of whom do not work leads.
  const dayCount = days.size || 1;
  const { target, ranked, topSkew } = fairShare(
    [...byOwner]
      .filter(([name]) => name !== 'Unassigned')
      .map(([name, { n, days: active }]) => ({ name, leads: n, activeDays: active.size })),
    rows.length,
    dayCount,
  );
  const owners = ranked;

  return [
    {
      kind: 'stats',
      title: 'The daily target',
      rows: [
        { label: 'Leads in period', value: int(rows.length), hint: `over ${dayCount} days that produced any` },
        { label: 'People taking leads', value: int(owners.length) },
        {
          label: 'Even share, per person per day',
          value: target.toFixed(1),
          hint: `The target: ${int(rows.length)} leads split evenly across ${owners.length} people over ${dayCount} days`,
        },
        {
          label: 'Busiest person',
          value: `${topSkew.toFixed(1)}× even share`,
          hint:
            topSkew >= 1.5
              ? 'The flow is uneven — see who is over and under below'
              : 'Reasonably even across the team',
        },
      ],
    },
    {
      kind: 'table',
      title: 'Against the target',
      columns: ['Owner', 'Leads', 'Per day', 'Days active', 'Share', 'vs target'],
      align: ['left', 'right', 'right', 'right', 'right', 'right'],
      rows: ranked.map((r) => [
        r.name,
        int(r.leads),
        r.perDay.toFixed(1),
        `${r.activeDays}/${dayCount}`,
        pct(r.share),
        // Signed, so over and under read at a glance rather than needing the target
        // held in your head.
        `${r.vsTarget >= 0 ? '+' : ''}${r.vsTarget.toFixed(0)}%`,
      ]),
    },
    {
      kind: 'note',
      title: 'How to act on this',
      body:
        'Leads are assigned in Zoho before they reach Growth Center, so this report measures ' +
        'the outcome rather than setting it. To change the split, adjust the assignment rules ' +
        'in Zoho CRM; this report will show the effect from the next sync onward.',
    },
  ];
}
