import { db } from '../prisma.ts';
import { insightHealth } from '../insight-health.ts';
import { speedToLead } from '../speed-to-lead.ts';
import { thresholds } from '../settings.ts';
import { fitness, type HashableStep } from '../outreach-approval.ts';
import { lintSequence } from '../outreach-lint.ts';
import { rate } from '../calc.ts';
import { assignedByOwner, int, ownerRows, pct, SEVERITY_RANK, type ReportContext, type Section } from './shared.ts';

export async function weeklyPack({ current }: ReportContext): Promise<Section[]> {
  // §17.1 names seven things. Five are computable and two are not, and the two say why
  // rather than being quietly dropped — a pack with five sections looks complete, and a
  // reader who does not know CPQL is missing will assume it was fine.
  const [pending, health, speed, limits, sequences, prospects, content] = await Promise.all([
    db().aiInsight.findMany({
      where: { status: 'proposed', ruleId: { not: null } },
      select: { title: true, severity: true, section: true, firstSeenAt: true, createdAt: true },
    }),
    insightHealth(current.from, current.to),
    speedToLead(current),
    thresholds(),
    db().sequence.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        copyApprovedByEmail: true,
        copyApprovedAt: true,
        copyApprovedHash: true,
        numbersVerifiedByEmail: true,
        numbersVerifiedAt: true,
        numbersVerifiedHash: true,
        steps: { select: { position: true, subject: true, body: true }, orderBy: { position: 'asc' } },
      },
    }),
    db().prospect.groupBy({ by: ['status'], _count: { _all: true } }),
    db().contentPiece.count(),
  ]);

  const now = new Date();
  const sla = limits['insights.approvalSlaHours'];
  const ageHours = (d: Date) => (now.getTime() - d.getTime()) / 3_600_000;

  const waiting = pending
    .map((f) => ({ ...f, hours: ageHours(f.firstSeenAt ?? f.createdAt) }))
    .sort((a, b) => b.hours - a.hours);
  const overdue = waiting.filter((f) => f.hours > sla);

  // Fitness, not the platform's status. Smartlead's own status says whether it is
  // sending; this says whether anybody signed off what it sends.
  const unfit = sequences.filter((seq) => {
    const steps = seq.steps as HashableStep[];
    return !fitness(seq, steps, lintSequence(steps)).fitToSend;
  });
  const blocked = sequences.filter((seq) => {
    const steps = seq.steps as HashableStep[];
    return fitness(seq, steps, lintSequence(steps)).blocked;
  });

  const prospectTotal = prospects.reduce((n, r) => n + r._count._all, 0);
  const byStatus = (name: string) => prospects.find((r) => r.status === name)?._count._all ?? 0;
  const rateOf = (n: number) => rate(n, prospectTotal);

  const age = (h: number) => (h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

  return [
    {
      kind: 'stats',
      title: 'Waiting on a decision',
      rows: [
        { label: 'Findings proposed', value: int(waiting.length) },
        {
          label: `Past the ${sla}-hour decision SLA`,
          value: int(overdue.length),
          hint: overdue.length ? `Oldest has waited ${age(overdue[0].hours)}` : undefined,
        },
        {
          // The denominator matters here and nowhere else in this section: on this
          // workspace it is every sequence, and "50" without "of 50" reads as a
          // backlog to work through rather than as nothing having been signed at all.
          label: 'Sequences not fit to send',
          value: `${int(unfit.length)} of ${int(sequences.length)}`,
          hint: `${blocked.length} carry a placeholder or scaffolding token, which no approval can override`,
        },
        {
          label: 'Content awaiting approval',
          value: content === 0 ? '—' : int(content),
          hint: content === 0 ? 'No content pieces exist yet' : undefined,
        },
      ],
    },
    {
      kind: 'table',
      title: 'The five that most need deciding',
      columns: ['Severity', 'Finding', 'Section', 'Waiting'],
      align: ['left', 'left', 'left', 'right'],
      rows: waiting.length
        ? waiting
            .slice()
            // Severity first, then longest waiting — the same order the digest uses,
            // so the pack and the email cannot disagree about what matters.
            .sort(
              (a, b) =>
                SEVERITY_RANK.indexOf(a.severity ?? 'medium') -
                  SEVERITY_RANK.indexOf(b.severity ?? 'medium') || b.hours - a.hours,
            )
            .slice(0, 5)
            .map((f) => [f.severity ?? 'medium', f.title, f.section ?? '—', age(f.hours)])
        : [['—', 'Nothing is waiting on a decision', '—', '—']],
    },
    {
      kind: 'stats',
      title: 'Speed to lead',
      rows: [
        {
          label: 'Median first response',
          value: speed.medianHours === null ? '—' : age(speed.medianHours),
          hint: `Across the ${int(speed.touched)} leads that were contacted at all`,
        },
        {
          label: 'Never contacted',
          value: `${int(speed.untouched)} (${pct(speed.untouchedPercent)})`,
          hint: `Past the ${speed.slaHours}-hour first-contact SLA with nothing logged`,
        },
        {
          label: 'Answered within an hour',
          value: `${int(speed.bands[0].leads)} (${pct(speed.bands[0].percent)})`,
        },
        {
          label: 'Too recent to judge',
          value: int(speed.tooRecent),
          hint: 'Arrived inside the SLA window — neither answered nor late',
        },
      ],
    },
    {
      kind: 'stats',
      title: 'Outreach deliverability',
      rows: [
        { label: 'Prospects in sequences', value: int(prospectTotal) },
        {
          label: 'Bounced',
          value: `${int(byStatus('bounced'))} (${pct(rateOf(byStatus('bounced')), 2)})`,
        },
        {
          label: 'Replied',
          value: `${int(byStatus('replied'))} (${pct(rateOf(byStatus('replied')), 2)})`,
        },
        {
          label: 'Unsubscribed',
          value: `${int(byStatus('unsubscribed'))} (${pct(rateOf(byStatus('unsubscribed')), 2)})`,
        },
      ],
    },
    {
      kind: 'table',
      title: 'Open action items by owner',
      columns: ['Owner', 'Assigned', 'In progress'],
      align: ['left', 'right', 'right'],
      rows: ownerRows(await assignedByOwner()),
    },
    {
      kind: 'stats',
      title: 'How last week was worked',
      rows: health.metrics.map((m) => ({
        label: m.label,
        value:
          m.value === null
            ? 'Not measured'
            : m.format === 'percent'
              ? pct(m.value)
              : age(m.value),
        hint: m.value === null ? m.unavailable : m.basis,
      })),
    },
    {
      kind: 'note',
      title: 'What this pack cannot tell you',
      body:
        'Two of the seven things this pack is meant to carry are missing, and they are missing ' +
        'from the data rather than from this report. CPQL by channel has no numerator: this CRM stamps ' +
        'a lead qualified only when it converts, so the consultation-booked event the figure ' +
        'divides by does not exist anywhere in the system, and per-channel spend exists for ' +
        'one paid channel. Content against calendar has nothing to compare: the content table ' +
        'is empty. Both appear here as a dash rather than a zero, because a zero would read ' +
        'as a measurement somebody took.',
    },
  ];
}
