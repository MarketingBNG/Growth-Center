import { db } from './prisma.ts';
import { convert } from './currency.ts';
import { currencySettings } from './settings.ts';
import { rate } from './calc.ts';
import type { Range } from './metrics.ts';

// The CRM screen's own figures: how many leads arrived, what the owners marked them as,
// and what came out the other end.
//
// Deliberately grouped on `sourceStatus` — the wording the CRM itself uses — rather than
// on the mapped `status`. The mapped vocabulary is shared across providers and has to
// collapse "Dead Lead", "Follow-up" and "Not Reachable" into `lost` and `contacted`, and
// those four distinctions are exactly what this team works to.

/** The statuses that get their own column, in the order the team reads them, with the
 *  CRM wording each matches. Anything else is counted under "Other" rather than dropped. */
export const LEAD_STATES = [
  { key: 'sq', label: 'SQ', hint: 'Semi-qualified', match: (v: string) => v.includes('qualified') },
  { key: 'followup', label: 'Follow-up', hint: 'Being worked', match: (v: string) => v.includes('follow') },
  {
    key: 'cnr',
    label: 'CNR',
    hint: 'Could not reach',
    match: (v: string) => v.includes('reachable') || v.includes('cnr'),
  },
  { key: 'dead', label: 'Dead', hint: 'Gone nowhere', match: (v: string) => v.includes('dead') || v.includes('lost') },
] as const;

export type LeadStateKey = (typeof LEAD_STATES)[number]['key'] | 'other';

/** Which column a raw CRM status belongs in. Order matters: "Not Qualified" would
 *  otherwise land in SQ, so it is tested for exclusion first. */
export function stateOf(sourceStatus: string | null | undefined): LeadStateKey {
  const v = (sourceStatus ?? '').toLowerCase();
  if (!v) return 'other';
  if (v.includes('not qualified') || v.includes('unqualified')) return 'other';
  for (const s of LEAD_STATES) if (s.match(v)) return s.key;
  return 'other';
}

const emptyCounts = (): Record<LeadStateKey, number> => ({
  sq: 0,
  followup: 0,
  cnr: 0,
  dead: 0,
  other: 0,
});

export type CrmOverview = Awaited<ReturnType<typeof crmOverview>>;

export async function crmOverview(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [byStatus, byOwner, leadTotal, converted, dealsCreated, wonRows] = await Promise.all([
    db().lead.groupBy({ by: ['sourceStatus'], where: { createdAt: window }, _count: { _all: true } }),
    // Owner AND status together: the allocation table is what each owner has marked, not
    // simply how many they hold.
    db().lead.groupBy({
      by: ['ownerEmail', 'sourceStatus'],
      where: { createdAt: window },
      _count: { _all: true },
    }),
    db().lead.count({ where: { createdAt: window } }),
    // Counted on the day the CRM converted them, not the day they arrived: a lead from
    // June converted in August belongs to August.
    db().lead.count({ where: { convertedAt: window } }),
    db().opportunity.count({ where: { createdAt: window } }),
    db().opportunity.findMany({
      where: { closedAt: window, stage: { isWon: true } },
      select: { value: true, currency: true },
    }),
  ]);

  const statuses = emptyCounts();
  for (const row of byStatus) statuses[stateOf(row.sourceStatus)] += row._count._all;

  const owners = new Map<string, { owner: string; total: number; counts: Record<LeadStateKey, number> }>();
  for (const row of byOwner) {
    const owner = row.ownerEmail ?? 'Unassigned';
    const entry = owners.get(owner) ?? { owner, total: 0, counts: emptyCounts() };
    entry.counts[stateOf(row.sourceStatus)] += row._count._all;
    entry.total += row._count._all;
    owners.set(owner, entry);
  }

  const fx = await currencySettings();
  const revenue = wonRows.reduce((t, o) => t + (convert(Number(o.value), o.currency, fx) ?? 0), 0);

  return {
    leads: leadTotal,
    statuses,
    owners: [...owners.values()].sort((a, b) => b.total - a.total),
    converted,
    conversionRate: rate(converted, leadTotal),
    dealsCreated,
    revenue,
    currency: fx.reporting,
    /** Deals won in the window, which is what `revenue` is the value of. */
    dealsWon: wonRows.length,
  };
}
