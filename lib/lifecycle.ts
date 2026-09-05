import { db } from './prisma.ts';
import { convert, sumInReporting } from './currency.ts';
import { currencySettings } from './settings.ts';
import { num } from './calc.ts';

// §8.2 and §8.3: the existing client, which is the cheapest revenue the firm has and had
// no system of record anywhere.
//
// The engagement half is already in the data and unread. This organisation suffixes its
// deal names "_One Time" and "_Retainer", `parseDealName` has understood that since deal
// origin was built, and `Opportunity.engagementType` carries it on 5,743 of 8,087 deals —
// 1,372 of them retainers. Nothing had ever grouped a customer by it.

/** How close a renewal has to be before it is worth somebody's week. §8.2 names 60 days. */
const RENEWAL_WINDOW_DAYS = 60;

/**
 * How long a client may go without being asked for a review or a referral.
 *
 * The manual says 90 days for a review and does not put a number on the referral ask.
 * Ninety for both, because they are the same conversation held at the same visit, and two
 * different clocks on one call would produce a flag that is always half-lit.
 */
const ASK_WINDOW_DAYS = 90;

export type LifecycleFlag = 'renewal_due' | 'no_review' | 'no_referral' | 'no_cross_sell';

export const FLAG_LABELS: Record<LifecycleFlag, string> = {
  renewal_due: 'Renewal inside 60 days',
  no_review: 'No review requested',
  no_referral: 'No referral asked',
  no_cross_sell: 'No cross-sell offered',
};

export type LifecycleRow = {
  customerId: string;
  companyId: string;
  company: string;
  wonAt: Date;
  /** Whole years since the account was won, for the anniversary view §8.2 asks for. */
  years: number;
  /** Days until the next anniversary. Negative is impossible; it wraps. */
  daysToAnniversary: number;
  engagementType: string | null;
  renewalDueAt: Date | null;
  lifetimeValue: number;
  flags: LifecycleFlag[];
};

const DAY = 86_400_000;

/**
 * Days from `from` to the next occurrence of its month-and-day on or after `now`.
 *
 * Written on UTC dates rather than by adding 365: an account won on 29 February would
 * otherwise drift a day a year, and an anniversary that moves is not an anniversary.
 */
export function daysToAnniversary(wonAt: Date, now: Date): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), wonAt.getUTCMonth(), wonAt.getUTCDate()),
  );
  if (next.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return Math.round(
    (next.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY,
  );
}

/**
 * The four flags for one customer.
 *
 * A retainer with no `renewalDueAt` is **not** flagged. The date is entered by hand
 * because the CRM records none, and flagging its absence would light the renewal warning
 * on all 1,372 retainers at once — which is a complaint about data entry wearing the
 * costume of a business alert.
 */
export function flagsFor(
  customer: {
    engagementType: string | null;
    renewalDueAt: Date | null;
    reviewRequestedAt: Date | null;
    referralAskedAt: Date | null;
    crossSellOfferedAt: Date | null;
    wonAt: Date;
  },
  now: Date,
): LifecycleFlag[] {
  const flags: LifecycleFlag[] = [];

  if (customer.engagementType === 'retainer' && customer.renewalDueAt) {
    const days = (customer.renewalDueAt.getTime() - now.getTime()) / DAY;
    // Past due counts. A renewal that lapsed three weeks ago is more urgent than one due
    // next month, and dropping it once the date passes is how a lapse becomes permanent.
    if (days <= RENEWAL_WINDOW_DAYS) flags.push('renewal_due');
  }

  // Measured from the ask, or from the win where there has never been one. A client of
  // three years who was asked once at signing is not a client who has been asked.
  const stale = (at: Date | null) =>
    (now.getTime() - (at ?? customer.wonAt).getTime()) / DAY > ASK_WINDOW_DAYS;

  if (stale(customer.reviewRequestedAt)) flags.push('no_review');
  if (stale(customer.referralAskedAt)) flags.push('no_referral');
  if (stale(customer.crossSellOfferedAt)) flags.push('no_cross_sell');

  return flags;
}

/**
 * Every customer with their engagement type, anniversary and flags.
 *
 * The engagement type comes from the deal that won them — `Opportunity.engagementType`,
 * read out of the deal name's "_One Time" / "_Retainer" suffix. A customer whose winning
 * deal carries no suffix is null rather than guessed at: 2,344 deals have no convention
 * in their name and calling them all one-off would report a retainer book a third too
 * small.
 */
export async function clientLifecycle(now = new Date()) {
  const [customers, money] = await Promise.all([
    db().customer.findMany({
      select: {
        id: true,
        companyId: true,
        wonAt: true,
        renewalDueAt: true,
        reviewRequestedAt: true,
        referralAskedAt: true,
        crossSellOfferedAt: true,
        company: { select: { name: true } },
        opportunity: { select: { engagementType: true } },
        revenue: { select: { amount: true, currency: true } },
      },
      // Churned accounts are excluded. A lapsed client cannot have a renewal due and
      // asking them for a review is a different conversation entirely.
      where: { churnedAt: null },
    }),
    currencySettings(),
  ]);

  const rows: LifecycleRow[] = customers.map((c) => {
    const engagementType = c.opportunity?.engagementType ?? null;
    return {
      customerId: c.id,
      companyId: c.companyId,
      company: c.company.name,
      wonAt: c.wonAt,
      years: Math.floor((now.getTime() - c.wonAt.getTime()) / (DAY * 365.25)),
      daysToAnniversary: daysToAnniversary(c.wonAt, now),
      engagementType,
      renewalDueAt: c.renewalDueAt,
      lifetimeValue: sumInReporting(
        c.revenue.map((r) => ({ amount: num(r.amount), currency: r.currency })),
        money,
      ).total,
      flags: flagsFor({ ...c, engagementType }, now),
    };
  });

  const byType = new Map<string, { customers: number; value: number }>();
  for (const row of rows) {
    const key = row.engagementType ?? 'unclassified';
    const acc = byType.get(key) ?? { customers: 0, value: 0 };
    acc.customers += 1;
    acc.value += row.lifetimeValue;
    byType.set(key, acc);
  }

  const flagCounts = new Map<LifecycleFlag, number>();
  for (const row of rows) {
    for (const flag of row.flags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }

  return {
    currency: money.reporting,
    total: rows.length,
    byEngagement: [...byType]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.value - a.value),
    flags: (Object.keys(FLAG_LABELS) as LifecycleFlag[]).map((flag) => ({
      flag,
      label: FLAG_LABELS[flag],
      customers: flagCounts.get(flag) ?? 0,
    })),
    /** Sorted by the number of flags, then by what the account is worth. The client with
     *  four unlit lifecycle touches and the largest balance is the one worth the call. */
    rows: rows.sort((a, b) => b.flags.length - a.flags.length || b.lifetimeValue - a.lifetimeValue),
    /** Anniversaries inside the next month, which is what makes the view actionable
     *  rather than a list of dates. */
    upcoming: rows
      .filter((r) => r.daysToAnniversary <= 30 && r.years >= 1)
      .sort((a, b) => a.daysToAnniversary - b.daysToAnniversary),
  };
}

export type Lifecycle = Awaited<ReturnType<typeof clientLifecycle>>;

/**
 * What an account is actually worth. §8.3.
 *
 * "One large engagement is currently moving the headline by 347%. A median tells you what
 * a client is actually worth." The CRM card reports a mean and nothing else, and a mean
 * over a book with one outsized engagement in it describes no account that exists.
 *
 * Quartiles as well as the median, because the median alone answers "what is typical" and
 * not "how wide is the spread" — and the spread is what says whether the firm has one
 * business or two.
 */
export async function accountValueDistribution() {
  const [customers, money] = await Promise.all([
    db().customer.findMany({
      select: { id: true, company: { select: { name: true } }, revenue: { select: { amount: true, currency: true } } },
    }),
    currencySettings(),
  ]);

  const values = customers
    .map((c) => ({
      id: c.id,
      name: c.company.name,
      value: c.revenue.reduce((sum, r) => sum + (convert(num(r.amount), r.currency, money) ?? 0), 0),
    }))
    // Accounts with no revenue recorded are excluded from the distribution, not counted
    // as zero. A won deal whose money has not been booked yet is unmeasured, and folding
    // it in as £0 drags the median toward a value no client was ever charged.
    .filter((c) => c.value > 0)
    .sort((a, b) => a.value - b.value);

  if (values.length === 0) {
    return { currency: money.reporting, count: 0, mean: null, median: null, p25: null, p75: null, outliers: [] };
  }

  const at = (q: number) => {
    const index = (values.length - 1) * q;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return lo === hi ? values[lo].value : values[lo].value + (values[hi].value - values[lo].value) * (index - lo);
  };

  const median = at(0.5);
  const p25 = at(0.25);
  const p75 = at(0.75);
  const mean = values.reduce((sum, v) => sum + v.value, 0) / values.length;

  // Tukey's fence: above the upper quartile by more than one and a half times the
  // interquartile range. A rule with a stated basis rather than "the top five", so an
  // account stops being an outlier when the book grows around it.
  const fence = p75 + 1.5 * (p75 - p25);

  return {
    currency: money.reporting,
    count: values.length,
    mean,
    median,
    p25,
    p75,
    /** How far the mean is being pulled. The manual's 347% complaint, as a number. */
    meanOverMedian: median > 0 ? mean / median : null,
    outliers: values
      .filter((v) => v.value > fence)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    outlierFence: fence,
  };
}
