import { db } from './prisma.ts';
import { convert } from './currency.ts';
import { currencySettings, thresholds } from './settings.ts';
import { THRESHOLDS, parseThresholdValue } from './thresholds.ts';
import { num, rate } from './calc.ts';
import { TAGS, cached } from './cache.ts';

// How much of the book can actually be traced to a channel.
//
// Every channel figure this app renders — the channel table, CAC, ROAS, "New revenue" per
// channel — is computed over the records that carry a channel, and silently divides by
// nothing where they do not. That is the right arithmetic and the wrong impression: a
// channel table drawn from 37% of the revenue looks exactly like one drawn from all of
// it. This measures the difference so a reader can see which they are looking at.
//
// ── What the live data says (measured, September 2026) ────────────────────────────────
//
//   Leads     27,349 of 27,458   99.6%   healthy, and healthy in every quarter
//   Deals      1,477 of  8,072   18.3%
//   Revenue    ₹2.13m of ₹5.69m  37.5%
//
// The three are measured separately because they are in genuinely different health, and
// one blended number would hide that. Leads are nearly perfect; the loss happens at the
// deal. 6,886 of the deals here were opened straight on an account and never converted
// from a lead, so the lead's channel never reaches them — which is why Opportunity
// carries its own channelId rather than borrowing one through a join.
//
// ── Why revenue is the one that gates ─────────────────────────────────────────────────
//
// A recommendation to move budget is a claim about money, so the coverage that qualifies
// it has to be money. Deal count is reported for diagnosis — it says where the loss is —
// but a workspace could attribute every small deal and no large one and still not be able
// to support the claim.

/** Coverage of one stage: how much of it reaches a channel. */
export type Coverage = {
  /** 0–100, or null where there is nothing in the period to measure. */
  percent: number | null;
  /** Records for counts; money in the reporting currency for revenue. */
  covered: number;
  total: number;
};

export type AttributionHealth = {
  leads: Coverage;
  deals: Coverage;
  revenue: Coverage;
  currency: string;
  /** The revenue coverage the workspace requires before channel figures are presented as
   *  a basis for moving money. */
  threshold: number;
  /** Whether revenue coverage clears it. Null when there is no revenue to judge — which
   *  is not the same as failing, and must not be rendered as a failure. */
  sufficient: boolean | null;
};

/**
 * The threshold, and where it lives.
 *
 * Read through lib/thresholds.ts, which owns every threshold in the application and its
 * default. This module had its own copy first — a default, a parser and a reader — and
 * two modules parsing one stored value is how they come to disagree about it: the older
 * parser here read `{percent}` while the newer store writes `{value}`, so a threshold
 * saved through one was invisible to the other.
 *
 * `DEFAULT_THRESHOLD` and `parseThreshold` are re-exported because the settings route and
 * its tests already import them from here. The 70% judgement, and the reasoning behind
 * it, now sit in lib/thresholds.ts alongside the other nine.
 */
export const THRESHOLD_KEY = 'attribution.threshold';

export const DEFAULT_THRESHOLD = THRESHOLDS[THRESHOLD_KEY].default;

export const parseThreshold = (value: unknown): number =>
  parseThresholdValue(THRESHOLD_KEY, value);

export async function attributionThreshold(): Promise<number> {
  return (await thresholds())[THRESHOLD_KEY];
}

const coverage = (covered: number, total: number): Coverage => ({
  percent: rate(covered, total),
  covered,
  total,
});

/** Just the coverage. Expensive — four counts and two grouped sums over revenue — and
 *  stale only as far as yesterday's snapshots, so this is the half worth caching. */
async function readCoverage(from: Date, to: Date) {
  const window = { gte: from, lte: to };

  const [leadTotal, leadCovered, dealTotal, dealCovered, revenueRows, fx] =
    await Promise.all([
      db().lead.count({ where: { createdAt: window } }),
      db().lead.count({ where: { createdAt: window, channelId: { not: null } } }),
      db().opportunity.count({ where: { createdAt: window } }),
      db().opportunity.count({ where: { createdAt: window, channelId: { not: null } } }),
      // Grouped by currency for the same reason every other money read here is: this
      // workspace books in both USD and INR, and a coverage ratio taken over mixed
      // currencies is a ratio between two different units.
      //
      // Attribution is read off the deal rather than off the revenue row. Both carry a
      // channelId and they agree today, but the deal is where the sync writes it and the
      // revenue row inherits it — so the deal is the record that can be fixed.
      db().revenueEntry.groupBy({
        by: ['currency'],
        where: { date: window },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      currencySettings(),
    ]);

  const attributedRows = await db().revenueEntry.groupBy({
    by: ['currency'],
    where: { date: window, opportunity: { is: { channelId: { not: null } } } },
    _sum: { amount: true },
  });

  // Amounts a currency has no rate for are dropped from BOTH sides rather than counted as
  // zero on one. Counting them only in the denominator would report a coverage shortfall
  // that is really a missing exchange rate.
  const sum = (rows: { currency: string | null; _sum: { amount: unknown } }[]) =>
    rows.reduce((total, r) => total + (convert(num(r._sum.amount), r.currency, fx) ?? 0), 0);

  const revenueTotal = sum(revenueRows);
  const revenueCovered = sum(attributedRows);
  const revenue = coverage(revenueCovered, revenueTotal);

  return {
    leads: coverage(leadCovered, leadTotal),
    deals: coverage(dealCovered, dealTotal),
    revenue,
    currency: fx.reporting,
  };
}

const cachedCoverage = cached('metrics:attribution-coverage', [TAGS.metrics], readCoverage);

/**
 * Coverage, plus the threshold it is judged against.
 *
 * The threshold is read outside the cache deliberately. Cached alongside the coverage it
 * went stale: a saved threshold did not reach either the card or the rule, because
 * `revalidateTag` does not drop an `unstable_cache` entry here — the same bug that made
 * lib/settings.ts read thresholds straight through. The measurement is expensive and
 * barely moves; the setting is one indexed row and moves the moment somebody changes it.
 */
export async function attributionHealth(from: Date, to: Date): Promise<AttributionHealth> {
  const [measured, threshold] = await Promise.all([
    cachedCoverage(from, to),
    attributionThreshold(),
  ]);

  return {
    ...measured,
    threshold,
    // Null, not false, with nothing to measure. A period with no revenue has not failed
    // an attribution standard, and greying out a channel table on that basis would be
    // reporting an empty month as a data-quality problem.
    sufficient: measured.revenue.percent === null ? null : measured.revenue.percent >= threshold,
  };
}

/**
 * A sentence for the channel table, or null when coverage is fine and the table needs no
 * qualification.
 *
 * Deliberately states the covered amount rather than the shortfall: "built on ₹2.1m of
 * ₹5.7m" is checkable against the Revenue card two inches away, where "63% unattributed"
 * is a number the reader has to take on trust.
 */
export function coverageCaveat(
  health: AttributionHealth,
  money: (n: number) => string,
): string | null {
  if (health.sufficient !== false) return null;
  const { covered, total, percent } = health.revenue;
  return `Built on ${money(covered)} of ${money(total)} — ${Math.round(percent ?? 0)}% of revenue reaches a channel, below the ${health.threshold}% this workspace requires. Treat the ranking as a hint, not a basis for moving budget.`;
}

