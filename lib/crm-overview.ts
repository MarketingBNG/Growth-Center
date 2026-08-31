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
  // 'semi-qualified', not 'qualified': Zoho's plain "Qualified" is a further stage than
  // "Semi-Qualified Lead" and ten leads carry it. Matching the substring folded them into
  // a column labelled Semi-qualified, which is a different thing.
  { key: 'sq', label: 'SQ', hint: 'Semi-qualified', match: (v: string) => v.includes('semi-qualified') || v.includes('semi qualified') },
  { key: 'followup', label: 'Follow-up', hint: 'Being worked', match: (v: string) => v.includes('follow') },
  {
    key: 'cnr',
    label: 'CNR',
    hint: 'Could not reach',
    match: (v: string) => v.includes('reachable') || v.includes('cnr'),
  },
  { key: 'dead', label: 'Dead', hint: 'Gone nowhere', match: (v: string) => v.includes('dead') || v.includes('lost') },
  // 2,910 leads sit here, and 41 of the 45 that arrived today. Without a column of its
  // own "Untouched Lead" fell into Other, so the panel reported nine tenths of a day's
  // leads as unclassified when the CRM had classified them precisely: nobody has picked
  // them up yet. That is the most actionable state on the board, not the leftover one.
  { key: 'untouched', label: 'Untouched', hint: 'Not picked up yet', match: (v: string) => v.includes('untouched') || v.includes('not contacted') },
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
  untouched: 0,
  other: 0,
});

export type CrmOverview = Awaited<ReturnType<typeof crmOverview>>;

export async function crmOverview(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [byStatus, byOwner, leadTotal, converted, cohortConverted, dealsCreated, wonRows] = await Promise.all([
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
    // The rate needs the other cohort. Dividing the count above by the leads that arrived
    // in the window compared two different sets of leads — 29 conversions over 1,388
    // arrivals read as "2.1% of leads" when 16 of those 1,388 had converted, and the 29
    // included leads that arrived months earlier.
    db().lead.count({ where: { createdAt: window, NOT: { convertedAt: null } } }),
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

  // A deal in a currency with no rate is left out rather than counted as though it were
  // already in the reporting one — the same rule channel spend follows, and said out loud
  // for the same reason: a total that quietly omits part of the money looks exactly like
  // a total that does not.
  let unrated = 0;
  const revenue = wonRows.reduce((t, o) => {
    const converted = convert(Number(o.value), o.currency, fx);
    if (converted === null) unrated++;
    return t + (converted ?? 0);
  }, 0);
  if (unrated) {
    console.warn(`[crm] ${unrated} won deals have a currency with no exchange rate and are missing from revenue.`);
  }

  return {
    leads: leadTotal,
    statuses,
    owners: [...owners.values()].sort((a, b) => b.total - a.total),
    converted,
    /** Of the leads that ARRIVED in this window, how many have converted so far. Not a
     *  share of `converted`, which counts conversions of leads from any time. */
    cohortConverted,
    conversionRate: rate(cohortConverted, leadTotal),
    dealsCreated,
    revenue,
    currency: fx.reporting,
    /** Deals won in the window, which is what `revenue` is the value of. */
    dealsWon: wonRows.length,
  };
}
