import { db } from './prisma.ts';
import { CONTACT_TYPES } from './metrics.ts';
import { thresholds } from './settings.ts';
import type { Range } from './metrics.ts';

// §7.5: "Owner scorecard: leads received, touched within SLA, semi-qualified rate,
// converted rate — per owner, per period."
//
// "Serves Nafis and Nilesh as much as marketing, and ends the argument about whether lead
// quality or lead handling is the problem."
//
// That last sentence is the design brief. The scorecard carries the median lead quality
// each owner was *given* alongside what they did with it, because a table of conversion
// rates without it settles the argument in marketing's favour by omission — and this
// workspace's leads range from a median of 16 on the chat channels to 53 on Canada.

export type OwnerRow = {
  ownerEmail: string | null;
  /** The short name the screens use. Null owner reads as "Unassigned". */
  name: string;
  leads: number;
  /** Touched at all, ever — not only inside the SLA. The denominator for the rest. */
  touched: number;
  /** First outbound touch inside the SLA window. */
  withinSla: number;
  /** Never touched. The number §7.2 calls the tail where paid leads die. */
  untouched: number;
  semiQualified: number;
  converted: number;
  slaRate: number | null;
  semiQualifiedRate: number | null;
  convertedRate: number | null;
  /** The median quality of what this person was handed. §7.5's whole point: handling and
   *  quality are two explanations for the same low conversion rate, and the argument
   *  cannot be settled without both on the same row. */
  medianScore: number | null;
};

const rate = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100);

/**
 * One row per owner over the period.
 *
 * Leads are counted by when they were created, not by when they converted. An owner
 * judged on conversions landing this month would be credited for work done in April and
 * blamed for leads they have had for three days.
 */
export async function ownerScorecard(range: Range): Promise<OwnerRow[]> {
  const window = { gte: range.from, lte: range.to };
  const slaHours = (await thresholds())['leads.slaHours'];

  const leads = await db().lead.findMany({
    where: { createdAt: window },
    select: {
      id: true,
      ownerEmail: true,
      status: true,
      score: true,
      scoreVersion: true,
      qualifiedAt: true,
      convertedAt: true,
      createdAt: true,
      // The first outbound touch, and only the kinds that count as one — the same list
      // medianResponseHours and the speed-to-lead distribution use, so three screens
      // cannot disagree about what "contacted" means.
      activities: {
        where: { type: { in: [...CONTACT_TYPES] } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  type Acc = Omit<OwnerRow, 'slaRate' | 'semiQualifiedRate' | 'convertedRate' | 'medianScore'> & {
    scores: number[];
  };
  const byOwner = new Map<string, Acc>();

  for (const lead of leads) {
    const key = lead.ownerEmail ?? '';
    let acc = byOwner.get(key);
    if (!acc) {
      acc = {
        ownerEmail: lead.ownerEmail,
        name: lead.ownerEmail ? lead.ownerEmail.split('@')[0] : 'Unassigned',
        leads: 0,
        touched: 0,
        withinSla: 0,
        untouched: 0,
        semiQualified: 0,
        converted: 0,
        scores: [],
      };
      byOwner.set(key, acc);
    }

    acc.leads += 1;

    const first = lead.activities[0]?.createdAt ?? null;
    if (first) {
      acc.touched += 1;
      const hours = (first.getTime() - lead.createdAt.getTime()) / 3_600_000;
      if (hours <= slaHours) acc.withinSla += 1;
    } else {
      acc.untouched += 1;
    }

    if (lead.status === 'semi_qualified' || lead.qualifiedAt !== null || lead.convertedAt !== null) {
      acc.semiQualified += 1;
    }
    if (lead.convertedAt !== null) acc.converted += 1;

    // Only leads the rules have scored. A null scoreVersion carries the column's
    // placeholder zero, and folding those in would report every owner as having been
    // handed worthless leads.
    if (lead.scoreVersion !== null) acc.scores.push(lead.score);
  }

  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  };

  return [...byOwner.values()]
    .map(({ scores, ...row }) => ({
      ...row,
      // Against every lead received, not against the touched ones. Excluding the untouched
      // is what made the median response time look healthy while 59% of leads had never
      // been contacted at all — the tail is the measure, not the exception to it.
      slaRate: rate(row.withinSla, row.leads),
      semiQualifiedRate: rate(row.semiQualified, row.leads),
      convertedRate: rate(row.converted, row.leads),
      medianScore: median(scores),
    }))
    // Busiest first. A scorecard sorted by conversion rate puts whoever received four
    // leads and converted one at the top, which is not a fact about performance.
    .sort((a, b) => b.leads - a.leads);
}

export type TaskLoad = {
  assigneeEmail: string | null;
  name: string;
  open: number;
  overdue: number;
  /** Open tasks raised more than 90 days ago — §19.2's hygiene metric, per person. */
  ageing: number;
  /** The oldest thing on their list, in days. */
  oldestDays: number | null;
};

/**
 * §19.4's "overdue counts by owner".
 *
 * The per-task-type SLA the clause also asks for — brief to design 48h, approval 24h,
 * reply handling 4h — needs a task type, and neither Zoho CRM nor Zoho Projects sends one
 * this app can read: every imported task is a title and a due date. So this reports what
 * the data supports, which is the overdue count and the age, and does not invent a
 * classification to hang three thresholds off.
 */
export async function taskLoad(now = new Date(), assignees?: string[]): Promise<TaskLoad[]> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const tasks = await db().task.findMany({
    where: {
      status: { in: ['open', 'in_progress'] },
      // Scoped to whoever the caller is reporting on. Passed in rather than read here so
      // this stays the answer to §19.4's question and not a second opinion about who
      // counts as a person.
      ...(assignees ? { assigneeEmail: { in: assignees } } : {}),
    },
    select: { assigneeEmail: true, dueDate: true, createdAt: true },
  });

  const byOwner = new Map<string, TaskLoad & { oldest: Date | null }>();

  for (const task of tasks) {
    const key = task.assigneeEmail ?? '';
    let acc = byOwner.get(key);
    if (!acc) {
      acc = {
        assigneeEmail: task.assigneeEmail,
        name: task.assigneeEmail ? task.assigneeEmail.split('@')[0] : 'Unassigned',
        open: 0,
        overdue: 0,
        ageing: 0,
        oldestDays: null,
        oldest: null,
      };
      byOwner.set(key, acc);
    }

    acc.open += 1;
    if (task.dueDate && task.dueDate < now) acc.overdue += 1;
    if (task.createdAt < ninetyDaysAgo) acc.ageing += 1;
    if (!acc.oldest || task.createdAt < acc.oldest) acc.oldest = task.createdAt;
  }

  return [...byOwner.values()]
    .map(({ oldest, ...row }) => ({
      ...row,
      oldestDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 86_400_000) : null,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}
