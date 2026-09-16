import { db } from '../platform/prisma.ts';
import { symbolOf, type CurrencySettings } from '../shared/currency.ts';
import { fmtRatio } from '../shared/format.ts';
import type { Range } from '../metrics.ts';

// The formatters, types and small aggregation helper every report builder shares. Split
// out of lib/reports.ts alongside the builders themselves — see that file's own comment
// for why.

export type Section =
  | { kind: 'stats'; title: string; rows: { label: string; value: string; hint?: string }[] }
  | { kind: 'table'; title: string; columns: string[]; align?: ('left' | 'right')[]; rows: string[][] }
  | { kind: 'note'; title: string; body: string };

/** What every report builder is handed: the resolved window and the money helpers, so
 *  none of them touches currencySettings() or windowFor() on its own. */
export type ReportContext = {
  current: Range;
  previous: Range;
  fx: CurrencySettings;
  money: (n: number | null) => string;
  inFx: (amount: unknown, currency: string | null) => number;
};

/** The reporting currency's symbol, not a dollar sign: this workspace reports in rupees
 *  and its ad spend is billed in them. */
export const moneyIn = (settings: CurrencySettings) => (n: number | null) =>
  n === null ? '—' : `${symbolOf(settings.reporting)}${Math.round(n).toLocaleString('en-US')}`;
export const int = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
// Not fmtPercent from lib/format.ts: that picks its own precision (2 places under 1%,
// otherwise 1), and every call site here already names the precision it wants — a report
// is printed once and read cold, without the adaptive rounding a live screen benefits
// from. int and moneyIn diverge from fmtNumber/fmtMoney the same way, for the same
// reporting-currency and no-decimals reasons documented where they are used.
export const pct = (n: number | null, d = 1) => (n === null ? '—' : `${n.toFixed(d)}%`);
// fmtRatio from lib/format.ts is the same rendering — "n.toFixed(2)×", "—" for null — so
// this reuses it rather than keeping a second copy.
export const ratio = fmtRatio;

/** Worst first. Shared with the digest so the pack and the email agree about order. */
export const SEVERITY_RANK = ['critical', 'high', 'medium', 'info'];

/** Findings somebody is actually carrying, by owner. */
export async function assignedByOwner() {
  return db().aiInsight.groupBy({
    by: ['ownerEmail', 'status'],
    where: { ownerEmail: { not: null }, status: { in: ['assigned', 'in_progress'] } },
    _count: { _all: true },
  });
}

/**
 * One row per owner, both counts on it.
 *
 * An empty result says so in words rather than rendering an empty table. On this workspace
 * it is empty and that is the finding: thirty-four findings are proposed and nobody is
 * carrying any of them.
 */
export function ownerRows(rows: { ownerEmail: string | null; status: string; _count: { _all: number } }[]): string[][] {
  if (!rows.length) return [['Nobody is carrying a finding yet', '—', '—']];

  const byOwner = new Map<string, { assigned: number; inProgress: number }>();
  for (const row of rows) {
    const owner = row.ownerEmail ?? 'Unassigned';
    const acc = byOwner.get(owner) ?? { assigned: 0, inProgress: 0 };
    if (row.status === 'assigned') acc.assigned += row._count._all;
    else acc.inProgress += row._count._all;
    byOwner.set(owner, acc);
  }

  return [...byOwner.entries()]
    .sort((a, b) => b[1].assigned + b[1].inProgress - (a[1].assigned + a[1].inProgress))
    .map(([owner, c]) => [owner, String(c.assigned), String(c.inProgress)]);
}

/**
 * Sums amounts (converted to the reporting currency by the caller) into one row per key.
 *
 * Was two independent copies — revenue-by-partner's `tally` and attribution's `fold` —
 * that did the same job with different field names and a different way of skipping a row
 * with no key. `keyOf` returning null skips the row; attribution's two callers never
 * produce null (they fall back to `''`), so unifying on "null skips" changes nothing for
 * them and is what revenue-by-partner's referral tally already relied on.
 */
export function sumByKey<T>(
  rows: T[],
  keyOf: (row: T) => string | null,
  amountOf: (row: T) => number,
  countOf: (row: T) => number = () => 1,
): { key: string; amount: number; count: number }[] {
  const out = new Map<string, { key: string; amount: number; count: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const acc = out.get(key) ?? { key, amount: 0, count: 0 };
    acc.amount += amountOf(row);
    acc.count += countOf(row);
    out.set(key, acc);
  }
  return [...out.values()].sort((a, b) => b.amount - a.amount);
}
