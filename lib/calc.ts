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
 *  has no CAC, it has a loss. */
export function cac(spend: number, customers: number): number | null {
  if (!customers) return null;
  return spend / customers;
}

/** Return per unit spent. Null when nothing was spent: organic revenue has no ROAS. */
export function roas(revenue: number, spend: number): number | null {
  if (!spend) return null;
  return revenue / spend;
}

export function costPer(spend: number, count: number): number | null {
  if (!count) return null;
  return spend / count;
}

/** Percentage change between periods, or null with no baseline. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
