import { db } from './prisma.ts';
import { rate } from './calc.ts';
import { thresholds } from './settings.ts';

// §21.6 — how the person approving this work knows the engine is working.
//
// Four numbers. Three are computable from the lifecycle now that findings have one; the
// fourth is not, and the manual is unusually clear about why that matters:
//
//   "Deferral rate on claim checks — stable, non-zero. Zero means the model has stopped
//    admitting uncertainty — treat as a defect, not a win."
//
// There are no claim checks. §20.4's pre-review does not exist, there is no corpus to
// check a claim against, and nothing in the application defers. Computed naively that
// rate is 0/0, and rendered as 0% it reads as the exact defect the manual warns about —
// a model that has stopped admitting uncertainty. So it is reported as unavailable, with
// the reason, and never as a figure.
//
// That is the shape of every number here: a health metric that cannot distinguish "good"
// from "not measured" is worse than an absent one, because someone will act on it.

export type HealthMetric = {
  key: string;
  label: string;
  /** Null where the figure cannot be computed. Never a stand-in zero. */
  value: number | null;
  format: 'percent' | 'hours';
  /** The band §21.6 gives, for the reader to compare against. */
  healthy: string;
  /** What it means when it drifts, from the manual. */
  drift: string;
  /** Why there is no figure, when there is none. */
  unavailable?: string;
  /** How many findings the figure rests on, so a rate over four items is not read as a
   *  trend. §21.6 gives no minimum, and a percentage from a handful of rows deserves the
   *  denominator printed beside it. */
  basis?: string;
};

export type InsightHealth = {
  metrics: HealthMetric[];
  /** Open findings, for context beside the rates. */
  open: number;
};

/**
 * The four numbers.
 *
 * Measured over findings raised in the window rather than transitions made in it: the
 * question §21.6 asks is whether the queue produces work that gets done, and a finding
 * raised in March and closed in April belongs to March's queue.
 */
export async function insightHealth(from: Date, to: Date): Promise<InsightHealth> {
  const window = { gte: from, lte: to };
  const limits = await thresholds();
  const slaHours = limits['insights.approvalSlaHours'];

  const [byStatus, open, closed] = await Promise.all([
    db().aiInsight.groupBy({
      by: ['status'],
      where: { firstSeenAt: window, ruleId: { not: null } },
      _count: { _all: true },
    }),
    db().aiInsight.count({
      where: { resolvedAt: null, status: { notIn: ['done', 'dismissed'] }, ruleId: { not: null } },
    }),
    // Findings that reached a decision, with the two timestamps the latency needs. Both
    // must be present: a row reviewed before firstSeenAt existed would produce a negative
    // age, and one negative value drags an average below the truth.
    db().aiInsight.findMany({
      where: {
        firstSeenAt: window,
        ruleId: { not: null },
        reviewedAt: { not: null },
        status: { notIn: ['proposed'] },
      },
      select: { firstSeenAt: true, reviewedAt: true, status: true },
    }),
  ]);

  const count = (status: string) =>
    byStatus.find((r) => r.status === status)?._count._all ?? 0;

  const total = byStatus.reduce((n, r) => n + r._count._all, 0);
  const done = count('done');
  const dismissed = count('dismissed');
  const assigned = count('assigned') + count('in_progress');

  // Ruled on: everything somebody has made a decision about. A finding still sitting in
  // `proposed` is not a low closure rate, it is an unread queue — and folding the two
  // together would make an untouched page look like a team that closes nothing.
  const ruled = total - count('proposed');

  const latencies = closed
    .map((r) =>
      r.firstSeenAt && r.reviewedAt
        ? (r.reviewedAt.getTime() - r.firstSeenAt.getTime()) / 3_600_000
        : null,
    )
    .filter((h): h is number => h !== null && h >= 0);

  // Median, not mean. One finding left for three weeks drags an average past the SLA and
  // says the process is broken when the other nine were same-day.
  const medianHours = latencies.length
    ? [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)]
    : null;

  const withinSla = latencies.filter((h) => h <= slaHours).length;

  return {
    open,
    metrics: [
      {
        key: 'closure',
        label: 'Closure rate on assigned work',
        // Of the findings somebody took on, how many were finished. Dismissals are
        // excluded from both sides: a dismissal is a decision, not work done, and
        // counting it as closure would let the rate be driven to 100% by dismissing
        // everything.
        value: rate(done, done + assigned),
        format: 'percent',
        healthy: 'Above 80%',
        drift: 'The queue is producing work nobody does — the owner map or the capacity is wrong.',
        basis: done + assigned === 0 ? 'Nothing assigned yet' : `${done} of ${done + assigned} assigned`,
        unavailable: done + assigned === 0 ? 'No finding has been assigned yet.' : undefined,
      },
      {
        key: 'dismissal',
        label: 'Dismissal rate',
        value: rate(dismissed, ruled),
        format: 'percent',
        healthy: '10–25%',
        drift:
          'Near zero means findings are being waved through; above a third means the thresholds are noisy.',
        basis: ruled === 0 ? 'Nothing ruled on yet' : `${dismissed} of ${ruled} ruled on`,
        unavailable: ruled === 0 ? 'No finding has been ruled on yet.' : undefined,
      },
      {
        key: 'deferral',
        label: 'Deferral rate on claim checks',
        // Deliberately null. See the note at the top of this file: rendered as 0% this
        // reads as the defect §21.6 warns about, when the truth is that nothing checks
        // claims at all.
        value: null,
        format: 'percent',
        healthy: 'Stable, non-zero',
        drift: 'Zero means the model has stopped admitting uncertainty — a defect, not a win.',
        unavailable:
          'Nothing checks claims yet. §20.4 pre-review needs a controlled corpus, which does not exist, so there is nothing to defer on — this is not a zero.',
      },
      {
        key: 'latency',
        label: 'Time from finding to decision',
        value: medianHours === null ? null : Number(medianHours.toFixed(1)),
        format: 'hours',
        healthy: `Under ${slaHours}h`,
        drift: 'The engine is only as fast as its slowest human step.',
        basis:
          latencies.length === 0
            ? 'Nothing decided yet'
            : `Median of ${latencies.length}; ${withinSla} inside ${slaHours}h`,
        unavailable: latencies.length === 0 ? 'No finding has been decided yet.' : undefined,
      },
    ],
  };
}
