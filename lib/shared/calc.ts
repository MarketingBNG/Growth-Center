// Pure metric arithmetic. No imports, so tools/*.test.ts can exercise it directly and
// every module computes CAC, ROAS and conversion the same way.

/** Prisma returns Decimal columns as objects; every number entering these helpers
 *  goes through here so a Decimal never reaches arithmetic as a string. */
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function pipelineValue(deals: { value: unknown; probability: number }[]) {
  let total = 0;
  let weighted = 0;
  for (const d of deals) {
    const v = num(d.value);
    total += v;
    weighted += (v * d.probability) / 100;
  }
  return { total, weighted };
}

/** Null rather than 0 or Infinity when there is no denominator — "no data" and "zero"
 *  are different, and a 0% CTR on an unserved campaign is a lie. */
export function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

export function ctr(clicks: number, impressions: number) {
  return rate(clicks, impressions);
}

/** Cost to acquire one customer. Null when nothing was won — spend with no customers
 *  has no CAC, it has a loss.
 *
 *  Also null when nothing was spent, which is the same rule roas already applies. Twelve
 *  customers from Facebook against no tracked spend divides to zero, and the table then
 *  states that acquiring them cost ₹0 — a claim, where the truth is that the cost is not
 *  known. Only paid channels carry spend here, so every organic row was making it. */
export function cac(spend: number, customers: number): number | null {
  if (!customers || !spend) return null;
  return spend / customers;
}

/** Return per unit spent. Null when nothing was spent: organic revenue has no ROAS. */
export function roas(revenue: number, spend: number): number | null {
  if (!spend) return null;
  return revenue / spend;
}

/** Same rule, and for the same reason: an untracked cost is unknown, never zero. */
export function costPer(spend: number, count: number): number | null {
  if (!count || !spend) return null;
  return spend / count;
}

/** Percentage change between periods, or null with no baseline. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export type OwnerLoad = { name: string; leads: number; activeDays: number };
export type OwnerShare = OwnerLoad & {
  /** Leads per day across the whole period, not per day worked — the target is a per-day
   *  figure and the two have to be the same kind of quantity to be compared. */
  perDay: number;
  /** Percentage of all leads in the period. */
  share: number;
  /** How far above or below an even share, as a percentage of that share. */
  vsTarget: number;
};

/**
 * Splits a period's leads across the people who took them, against an even share.
 *
 * The arithmetic that answers "does everyone get a fair lead flow every day". Pure and
 * here rather than inline in lib/reports.ts because the first version was wrong in a way
 * that looked plausible on screen: it divided each person by their OWN active days and
 * compared that against a target measured per calendar day, which put all eleven regular
 * owners above target at once. An average cannot have everyone above it, and a test says
 * so now.
 *
 * `days` is the number of days that produced any lead, not the calendar span — a quiet
 * weekend is not a shortfall anybody caused.
 */
export function fairShare(owners: OwnerLoad[], totalLeads: number, days: number) {
  const dayCount = days || 1;
  const evenShare = owners.length ? 100 / owners.length : 0;
  const target = owners.length ? totalLeads / owners.length / dayCount : 0;

  const ranked: OwnerShare[] = owners
    .map((o) => {
      const share = totalLeads ? (o.leads / totalLeads) * 100 : 0;
      return {
        ...o,
        perDay: o.leads / dayCount,
        share,
        vsTarget: evenShare ? (share / evenShare - 1) * 100 : 0,
      };
    })
    .sort((a, b) => b.leads - a.leads);

  return {
    /** Even split, per person per day. */
    target,
    evenShare,
    ranked,
    /** How many times its even share the busiest person takes. A busiest-to-quietest
     *  ratio would be governed entirely by whoever took one lead all month. */
    topSkew: ranked.length && evenShare ? ranked[0].share / evenShare : 1,
  };
}
