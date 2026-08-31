import { db } from './prisma.ts';
import { cac, costPer, num, rate, roas } from './calc.ts';
import { KPI_SERIES, SERIES_LABEL, kpiIsComparable, type Kpi, type KpiSeries } from './kpi.ts';
import { DEMO_SOURCE, INTERNAL_SOURCE } from './sources.ts';
import { convert, sumInReporting } from './currency.ts';
import { currencySettings } from './settings.ts';
import { DUPLICATE_MERGED_SUMMARY } from './leads.ts';
import { OPEN_DEAL } from './pipeline.ts';

// The Kpi shape and its delta live in lib/kpi.ts so client components can use them
// without pulling the database in. Re-exported here because this is where callers
// already expect to find them.
export { kpiDelta } from './kpi.ts';
export type { Kpi } from './kpi.ts';

// The one place dashboard, marketing and analytics numbers come from. If a figure
// appears on two pages it is computed here once, so the pages cannot disagree.

export type Range = { from: Date; to: Date };

/**
 * Blanks the change chip on any KPI whose data does not reach back into the period it is
 * being compared with.
 *
 * GA4 was connected on 27 July and Meta Ads a day earlier, so a 30-day view compared a
 * full month of sessions against the three days that happened to exist in the previous
 * window and reported "+800.9%". That is not growth — it is the date the integration was
 * switched on, printed as a trend. Spend does the same to CAC, ROAS and cost per lead,
 * and revenue, which begins in November 2024, does a milder version of it to any
 * 365-day comparison.
 *
 * `previous: null` is the existing "nothing to compare with" signal: kpiDelta() returns
 * null for it and the card simply omits the chip. The value itself is never touched —
 * only the claim about how it changed.
 *
 * Which series feeds which card lives in lib/kpi.ts, where it can be unit-tested.
 */
async function comparableDeltas(cards: Kpi[], current: Range, previous: Range): Promise<Kpi[]> {
  const [sessions, spend, leads, deals, revenue, customers, sessionSources, spendSources, leadSources, dealSources] =
    await Promise.all([
      db().metricSnapshot.findFirst({ where: { metricKey: 'sessions' }, orderBy: { date: 'asc' }, select: { date: true } }),
      db().marketingSpend.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
      db().lead.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      db().opportunity.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      db().revenueEntry.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
      db().customer.findFirst({ orderBy: { wonAt: 'asc' }, select: { wonAt: true } }),
      // Who actually wrote each series, read from the rows rather than assumed. A second
      // analytics provider, or Meta being replaced, changes these labels on its own.
      db().metricSnapshot.findMany({ where: { metricKey: 'sessions' }, select: { source: true }, distinct: ['source'] }),
      db().campaign.findMany({ where: { spend: { some: {} } }, select: { source: true }, distinct: ['source'] }),
      db().lead.findMany({ select: { source: true }, distinct: ['source'] }),
      db().opportunity.findMany({ select: { source: true }, distinct: ['source'] }),
    ]);

  const starts = {
    sessions: sessions?.date ?? null,
    spend: spend?.date ?? null,
    leads: leads?.createdAt ?? null,
    deals: deals?.createdAt ?? null,
    revenue: revenue?.date ?? null,
    customers: customers?.wonAt ?? null,
  };

  const ids = (rows: { source: string | null }[]) =>
    [...new Set(rows.map((r) => r.source ?? INTERNAL_SOURCE))];

  // Revenue and customers are derived from won deals rather than imported, so they carry
  // the deals' provenance — that is genuinely where the money figures come from.
  const sourcesFor: Record<KpiSeries, string[]> = {
    sessions: ids(sessionSources),
    spend: ids(spendSources),
    leads: ids(leadSources),
    deals: ids(dealSources),
    revenue: ids(dealSources),
    customers: ids(dealSources),
  };

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  /** The series behind `key` that does not reach back to `from`, if any. */
  const shortfall = (key: string, from: Date) => {
    const series = KPI_SERIES[key] ?? [];
    const short = series.find((k) => {
      const start = starts[k];
      return !start || start.getTime() > from.getTime();
    });
    const startedAt = short ? starts[short] : null;
    return short && startedAt ? { series: short, startedAt } : null;
  };

  return cards.map((card) => {
    const series = KPI_SERIES[card.key] ?? [];
    const sources = [...new Set(series.flatMap((k) => sourcesFor[k]))];

    // A card built from TWO series is a ratio, and a ratio is only meaningful when both
    // of its inputs cover the same span. Ad spend begins on 27 July 2026 while customers
    // and revenue go back years, so over any longer window CAC divided a month of spend
    // by a year of customers (₹289) and ROAS divided a year of revenue by a month of
    // spend (542.91x). Neither is a small error — they are off by the ratio of the two
    // spans, and they were the two largest figures on the page.
    //
    // Single-series cards are left alone. 6,456 visitors over a year is an incomplete
    // count but it is a true one; only the division is unsound.
    if (series.length > 1) {
      const gap = shortfall(card.key, current.from);
      if (gap) {
        return {
          ...card,
          sources,
          value: null,
          previous: null,
          comparisonNote: `${SERIES_LABEL[gap.series]} data only goes back to ${fmtDate(gap.startedAt)}, so this cannot be measured over the whole period`,
        };
      }
    }

    if (kpiIsComparable(card.key, previous.from, starts)) return { ...card, sources };

    // Name the series that falls short and the date it begins, so the card explains
    // itself instead of just going quiet.
    const gap = shortfall(card.key, previous.from);
    const comparisonNote = gap
      ? `${SERIES_LABEL[gap.series]} data only goes back to ${fmtDate(gap.startedAt)}, so there is nothing to compare with`
      : 'Not enough history to compare with';

    return { ...card, sources, previous: null, comparisonNote };
  });
}

/** A period and the equally-long period immediately before it, for deltas. */
export function rangeFor(days: number, now = new Date()): { current: Range; previous: Range } {
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);

  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  prevTo.setUTCHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  prevFrom.setUTCHours(0, 0, 0, 0);

  return { current: { from, to }, previous: { from: prevFrom, to: prevTo } };
}

/** The equally-long period ending the instant before `range` starts. The comparison
 *  window for a hand-picked one, derived the same way `rangeFor` derives its own. */
export function previousOf(range: Range): Range {
  const span = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime() - 1);
  return { from: new Date(to.getTime() - span), to };
}

/**
 * A window and the period to compare it against, from either a preset day count or a
 * window someone picked on a calendar.
 *
 * The KPI functions took a day count alone, so a `?from=&to=` window reached the figures
 * a page computed for itself but never the cards and chart beside them: the CRM screen
 * could show June's leads over the last thirty days' companies, each labelled as though
 * it were the range in the picker.
 */
export function windowFor(spec: number | Range, now = new Date()): { current: Range; previous: Range } {
  return typeof spec === 'number'
    ? rangeFor(spec, now)
    : { current: spec, previous: previousOf(spec) };
}


/**
 * Seeded rows carry source 'demo'. Real ones carry the integration id.
 *
 * Once a provider has written even one row for a metric, the demo rows for that metric
 * must stop counting or the two are summed — connecting GA4 would have roughly doubled
 * the visitor count overnight, real sessions piled on top of invented ones.
 *
 * Scoped per metric, not globally, so a live Meta connection does not blank out the
 * seeded figures on pages nothing real writes to yet.
 */
export async function excludeDemo(metricKey: string): Promise<{ not: 'demo' } | undefined> {
  const live = await db().metricSnapshot.findFirst({
    where: { metricKey, source: { not: 'demo' } },
    select: { id: true },
  });
  return live ? { not: 'demo' } : undefined;
}

async function sessions(range: Range): Promise<number> {
  return siteMetric('sessions', range);
}

/**
 * The first day the sessions series has data for, or null if it has none.
 *
 * The funnel puts visitors above leads, but sessions arrive from GA4 and leads from the
 * CRM, and the two do not begin on the same day — GA4 was connected on 28 July 2026 and
 * the CRM holds years. Over any window reaching back further than GA4 does, the visitor
 * count is not a smaller number than leads because the funnel leaked; it is a shorter
 * series. Compared once here so the pages that draw the funnel can say so rather than
 * printing a 251% visitor-to-lead rate.
 *
 * `comparableDeltas` reads the same row for the same reason, but only to blank a change
 * chip. This is the funnel's own version of that question.
 */
export async function sessionsStart(): Promise<Date | null> {
  const first = await db().metricSnapshot.findFirst({
    where: { metricKey: 'sessions', source: await excludeDemo('sessions') },
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  return first?.date ?? null;
}

/** The first day ad spend was recorded, or null if none ever was. The same question
 *  `sessionsStart` answers, for the series that makes CAC and ROAS a ratio. */
export async function spendStart(): Promise<Date | null> {
  const first = await db().marketingSpend.findFirst({
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  return first?.date ?? null;
}

/** Any site-wide daily metric, summed over a range. GA4 and Search Console both report
 *  several of these and only `sessions` was ever read. */
export async function siteMetric(metricKey: string, range: Range): Promise<number> {
  const result = await db().metricSnapshot.aggregate({
    where: {
      metricKey,
      date: { gte: range.from, lte: range.to },
      source: await excludeDemo(metricKey),
    },
    _sum: { value: true },
  });
  return Math.round(num(result._sum.value));
}


/**
 * The funnel for one period.
 *
 * Qualified counts leads that reached qualified at any point, not leads currently
 * sitting in that status — otherwise converting a lead would decrease the qualified
 * count and the funnel would appear to leak backwards.
 *
 * Semi-qualified is its own stage. This CRM's "Semi-Qualified Lead" used to reach
 * `qualified` through a substring match, so "qualified leads" was 2,480 semi-qualified
 * ones and 10 fully qualified ones. Counted as "reached at least semi-qualified" — the
 * current status, or any later stage — so it stays above `qualified` and cannot leak
 * backwards either.
 */
export async function funnel(range: Range, channelId?: string) {
  const window = { gte: range.from, lte: range.to };

  // Scoped to one channel when the page asks for it, so the Marketing band describes the
  // channel its filter is set to rather than the whole business. Blended, a ROAS of 225x
  // sat above a table of Meta campaigns that had earned none of it.
  //
  // Every entity below carries its own channel except sessions, which arrive from GA4 for
  // the site as a whole and cannot be attributed to one. Filtered, visitors is therefore 0
  // and visitorToLead falls to null rather than dividing a channel's leads by the whole
  // site's traffic.
  const byChannel = channelId ? { channelId } : {};
  const customerWhere = channelId
    ? {
        wonAt: window,
        // Lead first, deal second — the same precedence channelPerformance and the revenue
        // insert use, so a customer lands on the channel their money did.
        OR: [
          { opportunity: { is: { lead: { is: { channelId } } } } },
          { opportunity: { is: { lead: { is: null }, channelId } } },
        ],
      }
    : { wonAt: window };

  const [visitors, leads, semiQualified, qualified, opportunities, customers, revenueAgg, newRevenueAgg, spendAgg] =
    await Promise.all([
      channelId ? Promise.resolve(0) : sessions(range),
      db().lead.count({ where: { createdAt: window, ...byChannel } }),
      db().lead.count({
        where: {
          createdAt: window,
          ...byChannel,
          OR: [{ status: 'semi_qualified' }, { qualifiedAt: { not: null } }],
        },
      }),
      db().lead.count({ where: { createdAt: window, qualifiedAt: { not: null }, ...byChannel } }),
      db().opportunity.count({ where: { createdAt: window, ...byChannel } }),
      db().customer.count({ where: customerWhere }),
      // Grouped by currency rather than summed flat. This account's deals are written in
      // both USD and INR and its ad spend is billed in INR, and adding those together
      // produced a revenue figure roughly half of which was rupees counted as dollars.
      db().revenueEntry.groupBy({ by: ['currency'], where: { date: window, ...byChannel }, _sum: { amount: true } }),
      // New business only. Recurring income from customers won in earlier periods is
      // real revenue but it is NOT a return on this period's marketing spend — counting
      // it produced an 18x blended ROAS on a month where new business was a third of
      // the total.
      db().revenueEntry.groupBy({ by: ['currency'], where: { date: window, kind: 'one_time', ...byChannel }, _sum: { amount: true } }),
      // Spend reaches a channel through its campaign; there is no channel on a spend row.
      db().marketingSpend.groupBy({
        by: ['currency'],
        where: { date: window, ...(channelId ? { campaign: { is: { channelId } } } : {}) },
        _sum: { amount: true },
      }),
    ]);

  const money = await currencySettings();
  const inReporting = (
    rows: { currency: string | null; _sum: { amount: unknown } }[],
  ) => sumInReporting(rows.map((r) => ({ amount: num(r._sum.amount), currency: r.currency })), money);

  const revenueSum = inReporting(revenueAgg);
  const newRevenueSum = inReporting(newRevenueAgg);
  const spendSum = inReporting(spendAgg);

  const revenue = revenueSum.total;
  const newRevenue = newRevenueSum.total;
  const spend = spendSum.total;

  return {
    currency: money.reporting,
    /** Amounts in a currency the workspace has no rate for, so the page can say what a
     *  total leaves out rather than presenting it as complete. */
    unconverted: [...revenueSum.unconverted, ...spendSum.unconverted],
    visitors,
    leads,
    semiQualified,
    qualified,
    opportunities,
    customers,
    revenue,
    newRevenue,
    spend,
    visitorToLead: rate(leads, visitors),
    leadToSemiQualified: rate(semiQualified, leads),
    leadToQualified: rate(qualified, leads),
    qualifiedToOpportunity: rate(opportunities, qualified),
    opportunityToCustomer: rate(customers, opportunities),
    cac: cac(spend, customers),
    roas: roas(newRevenue, spend),
  };
}

export type Funnel = Awaited<ReturnType<typeof funnel>>;

/** Open pipeline, which is a snapshot rather than a period — a deal opened last year
 *  is still in the pipeline today, so this deliberately ignores the date range. */
export async function openPipeline() {
  const deals = await db().opportunity.findMany({
    where: OPEN_DEAL,
    select: { value: true, probability: true, currency: true },
  });

  // Deals here are written in both USD and INR. Added flat, 143 rupee deals worth ₹5.2m
  // doubled the pipeline.
  const money = await currencySettings();
  let total = 0;
  let weighted = 0;
  for (const d of deals) {
    const v = convert(num(d.value), d.currency, money);
    if (v === null) continue;
    total += v;
    weighted += (v * d.probability) / 100;
  }
  return { count: deals.length, total, weighted, currency: money.reporting };
}


/**
 * The KPI row, plus the funnel it was computed from.
 *
 * Returns `current` so callers do not recompute it — the dashboard needs both the
 * cards and the funnel, and calling funnel() again cost another 7 queries at ~280ms
 * round trip each.
 */
export async function kpis(days: number): Promise<{ cards: Kpi[]; current: Funnel; previous: Funnel }> {
  const { current, previous } = rangeFor(days);
  const [now, before] = await Promise.all([funnel(current), funnel(previous)]);

  const cards: Kpi[] = [
    { key: 'visitors', label: 'Visitors', value: now.visitors, previous: before.visitors, format: 'number', higherIsBetter: true },
    { key: 'leads', label: 'Leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'qualified', label: 'Qualified leads', value: now.qualified, previous: before.qualified, format: 'number', higherIsBetter: true },
    { key: 'opportunities', label: 'Opportunities', value: now.opportunities, previous: before.opportunities, format: 'number', higherIsBetter: true },
    { key: 'customers', label: 'New customers', value: now.customers, previous: before.customers, format: 'number', higherIsBetter: true },
    { key: 'revenue', label: 'Revenue', value: now.revenue, previous: before.revenue, format: 'money', currency: now.currency, higherIsBetter: true, hint: 'All revenue booked, including recurring' },
    { key: 'newRevenue', label: 'New business', value: now.newRevenue, previous: before.newRevenue, format: 'money', currency: now.currency, higherIsBetter: true, hint: 'Deals won in this period' },
    { key: 'spend', label: 'Marketing spend', value: now.spend, previous: before.spend, format: 'money', currency: now.currency, higherIsBetter: false },
    { key: 'cac', label: 'CAC', value: now.cac, previous: before.cac, format: 'money', currency: now.currency, higherIsBetter: false, hint: 'Blended: all paid spend over every new customer, however they arrived' },
    { key: 'roas', label: 'ROAS', value: now.roas, previous: before.roas, format: 'ratio', higherIsBetter: true, hint: 'Blended: new business over all paid spend. Meta is the only paid channel, and most revenue arrives by referral and inbound — this is not Meta’s return' },
  ];

  return { cards: await comparableDeltas(cards, current, previous), current: now, previous: before };
}


/**
 * Daily or monthly series for the trend charts.
 *
 * Buckets are built in JS from one query per metric rather than grouped in SQL: the
 * date column is a DATE and grouping by month needs a cast that differs per driver,
 * and at 365 rows the cost is irrelevant.
 */
export async function trend(range: Range, bucket: 'day' | 'month', channelId?: string) {
  const demo = await excludeDemo('sessions');

  // Scoped to a channel when asked. Sessions are site-wide and carry no channel, so a
  // filtered series has no visitors rather than the whole site's — the marketing chart
  // plots revenue and spend only, and a visitor count that ignored the filter would be
  // the one number on it that meant something else.
  const chan = channelId ? [channelId] : [];

  // Bucketed by Postgres rather than in JavaScript.
  //
  // This used to fetch every row and group them in a Map: 16,517 lead rows pulled to
  // produce twelve numbers, which was the slowest thing on the dashboard at ~2s. The
  // date maths is identical, not merely similar — `createdAt` is `timestamp without
  // time zone` holding UTC and the money columns are plain `date`, so `date_trunc`
  // agrees with the old `toISOString().slice()` exactly, with no zone to convert. The
  // server runs GMT besides. `bucketKey` below pins the shape the SQL must produce,
  // and the two implementations were compared bucket-by-bucket against the live
  // database over four ranges and both units — 572 values, all identical.
  //
  // Money is still grouped BY CURRENCY and converted here, not summed in SQL: Postgres
  // has no exchange rates, and adding INR to USD is the bug this chart had.
  const unit = bucket === 'month' ? 'month' : 'day';
  const format = bucket === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
  const at = (col: string) => `to_char(date_trunc('${unit}', ${col}), '${format}')`;

  type Counted = { bucket: string; total: number | string | null };
  type Money = { bucket: string; currency: string | null; total: number | string | null };

  const [sessionRows, leadRows, revenueRows, spendRows] = await Promise.all([
    channelId
      ? Promise.resolve([] as Counted[])
      : db().$queryRawUnsafe<Counted[]>(
          `SELECT ${at('date')} AS bucket, SUM(value) AS total
             FROM metric_snapshot
            WHERE "metricKey" = 'sessions' AND date >= $1 AND date <= $2
              ${demo ? `AND source <> 'demo'` : ''}
            GROUP BY 1`,
          range.from,
          range.to,
        ),
    db().$queryRawUnsafe<Counted[]>(
      `SELECT ${at('"createdAt"')} AS bucket, COUNT(*) AS total
         FROM lead
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
          ${channelId ? `AND "channelId" = $3` : ''}
        GROUP BY 1`,
      range.from,
      range.to,
      ...chan,
    ),
    db().$queryRawUnsafe<Money[]>(
      `SELECT ${at('date')} AS bucket, currency, SUM(amount) AS total
         FROM revenue_entry
        WHERE date >= $1 AND date <= $2
          ${channelId ? `AND "channelId" = $3` : ''}
        GROUP BY 1, 2`,
      range.from,
      range.to,
      ...chan,
    ),
    // Spend has no channel of its own; it reaches one through its campaign.
    db().$queryRawUnsafe<Money[]>(
      `SELECT ${at('date')} AS bucket, currency, SUM(amount) AS total
         FROM marketing_spend
        WHERE date >= $1 AND date <= $2
          ${channelId ? `AND "campaignId" IN (SELECT id FROM campaign WHERE "channelId" = $3)` : ''}
        GROUP BY 1, 2`,
      range.from,
      range.to,
      ...chan,
    ),
  ]);

  const fx = await currencySettings();

  const buckets = new Map<string, { date: string; visitors: number; leads: number; revenue: number; spend: number }>(
    emptyBuckets(range, bucket).map((k) => [
      k,
      { date: k, visitors: 0, leads: 0, revenue: 0, spend: 0 },
    ]),
  );
  const bucketAt = (key: string) => {
    let row = buckets.get(key);
    if (!row) {
      row = { date: key, visitors: 0, leads: 0, revenue: 0, spend: 0 };
      buckets.set(key, row);
    }
    return row;
  };

  const unconverted = new Set<string>();
  // A currency with no rate is left out rather than added at face value: a wrong number
  // on a chart is worse than a slightly low one, and the warning says so.
  const addMoney = (rows: Money[], field: 'revenue' | 'spend') => {
    for (const r of rows) {
      const converted = convert(num(r.total), r.currency, fx);
      if (converted === null) unconverted.add(r.currency ?? 'unknown');
      else bucketAt(r.bucket)[field] += converted;
    }
  };

  for (const r of sessionRows) bucketAt(r.bucket).visitors += num(r.total);
  for (const r of leadRows) bucketAt(r.bucket).leads += num(r.total);
  addMoney(revenueRows, 'revenue');
  addMoney(spendRows, 'spend');

  if (unconverted.size) {
    console.warn(`[metrics] trend: no exchange rate for ${[...unconverted].join(', ')}; those amounts are missing from the chart.`);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Per-channel performance. Leads and revenue join through channelId, which every
 *  lead and revenue row carries, so this needs no walk up the funnel. */
export async function channelPerformance(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [channels, leadsByChannel, revenueByChannel, spendByCampaign, campaigns, customersByChannel] =
    await Promise.all([
      db().channel.findMany({ select: { id: true, name: true, kind: true } }),
      db().lead.groupBy({ by: ['channelId'], where: { createdAt: window }, _count: { _all: true } }),
      db().revenueEntry.groupBy({ by: ['channelId', 'currency'], where: { date: window, kind: 'one_time' }, _sum: { amount: true } }),
      db().marketingSpend.groupBy({
        // By currency too: this account's spend is billed in rupees and its revenue is
        // mostly written in dollars, and a per-channel ROAS that divides one by the other
        // is wrong by the exchange rate.
        by: ['campaignId', 'currency'],
        where: { date: window },
        _sum: { amount: true, clicks: true, impressions: true },
      }),
      db().campaign.findMany({ select: { id: true, channelId: true } }),
      // The deal's own channel as well as the lead's, in the same order revenue resolves
      // them. Customers counted by the lead alone while the revenue beside them counted
      // either put a channel's customers and its money on different rows: Direct read as
      // five customers against ₹395,038, and every CAC built from the pair was wrong.
      db().customer.findMany({
        where: { wonAt: window },
        select: {
          opportunity: { select: { channelId: true, lead: { select: { channelId: true } } } },
        },
      }),
    ]);

  const money = await currencySettings();
  const campaignChannel = new Map(campaigns.map((c) => [c.id, c.channelId]));
  const spendByChannel = new Map<string, { spend: number; clicks: number; impressions: number }>();
  for (const row of spendByCampaign) {
    const channelId = campaignChannel.get(row.campaignId);
    if (!channelId) continue;
    const acc = spendByChannel.get(channelId) ?? { spend: 0, clicks: 0, impressions: 0 };
    // A currency with no rate is left out of the total rather than added as though it
    // were already in the reporting one — but said out loud, because a total that quietly
    // omits part of the spend understates CAC and overstates ROAS, and looks right doing
    // it. Unreachable while the workspace only reports USD and INR, both of which carry
    // rates; it stops being unreachable the day a third currency arrives.
    const converted = convert(num(row._sum.amount), row.currency, money);
    if (converted === null) {
      console.warn(
        `[metrics] ${row.currency} has no exchange rate, so ${num(row._sum.amount)} of spend is missing from the channel totals.`,
      );
    }
    acc.spend += converted ?? 0;
    acc.clicks += row._sum.clicks ?? 0;
    acc.impressions += row._sum.impressions ?? 0;
    spendByChannel.set(channelId, acc);
  }

  // '' is the unattributed bucket, here and in leadCount and revenueSum below — a lead
  // whose channelId is null still happened, and dropping it makes the table disagree with
  // every other lead count in the app.
  const customerCount = new Map<string, number>();
  for (const c of customersByChannel) {
    // Lead first, deal second, unattributed last — the same COALESCE the revenue insert
    // applies, so a customer and the money they brought land on the same row.
    const key = c.opportunity?.lead?.channelId ?? c.opportunity?.channelId ?? '';
    customerCount.set(key, (customerCount.get(key) ?? 0) + 1);
  }

  const leadCount = new Map(leadsByChannel.map((r) => [r.channelId ?? '', r._count._all]));
  const revenueSum = new Map<string, number>();
  for (const r of revenueByChannel) {
    const key = r.channelId ?? '';
    revenueSum.set(key, (revenueSum.get(key) ?? 0) + (convert(num(r._sum.amount), r.currency, money) ?? 0));
  }

  const rows = channels
    .map((ch) => {
      const spend = spendByChannel.get(ch.id) ?? { spend: 0, clicks: 0, impressions: 0 };
      const leads = leadCount.get(ch.id) ?? 0;
      const revenue = revenueSum.get(ch.id) ?? 0;
      const customers = customerCount.get(ch.id) ?? 0;
      return {
        id: ch.id,
        name: ch.name,
        kind: ch.kind,
        spend: spend.spend,
        clicks: spend.clicks,
        impressions: spend.impressions,
        leads,
        customers,
        revenue,
        ctr: rate(spend.clicks, spend.impressions),
        // costPer(), not spend/leads: untracked spend is unknown, never zero. Divided
        // directly, every organic channel reported a cost per lead of exactly ₹0 — a
        // claim that acquiring 3,968 Facebook leads was free, where the truth is that
        // nothing measured what it cost.
        costPerLead: costPer(spend.spend, leads),
        cac: cac(spend.spend, customers),
        roas: roas(revenue, spend.spend),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

  // Everything that reached no channel, named rather than dropped.
  //
  // These rows used to be left out entirely, so the Leads column summed to 1,064 fewer
  // than the workspace's own lead count with nothing on the page to say why. They are not
  // put in Direct: Direct means someone arrived by typing the address, and 934 of these
  // are filed under a service line that says nothing about how the person found the firm.
  // Unattributed is the true statement, and it belongs on the page precisely because it
  // is the row that shows how much of the table cannot be trusted to attribute spend.
  //
  // Last, whatever its size, and never sorted up among the real channels. No spend can
  // reach it — spend joins through a campaign, which always carries a channel — so CAC
  // and ROAS stay null rather than dividing by a zero that means "not measured".
  const unattributed = {
    id: 'unattributed',
    name: 'Unattributed',
    kind: 'unknown',
    spend: 0,
    clicks: 0,
    impressions: 0,
    leads: leadCount.get('') ?? 0,
    customers: customerCount.get('') ?? 0,
    revenue: revenueSum.get('') ?? 0,
    ctr: null,
    costPerLead: null,
    cac: null,
    roas: null,
  };

  const hasAny = unattributed.leads > 0 || unattributed.customers > 0 || unattributed.revenue > 0;
  return hasAny ? [...rows, unattributed] : rows;
}

export type ChannelRow = Awaited<ReturnType<typeof channelPerformance>>[number];

// ─── operational metrics for the per-module analytics band ────────────────────
//
// These live here rather than in the pages that show them so a figure appearing on two
// screens cannot disagree with itself. Every one returns null rather than 0 where there
// is no denominator, per the rule in lib/calc.ts.

/** An outbound touch. A status flip to `contacted` is not one — someone can change a
 *  dropdown without ever having contacted the lead. */
const CONTACT_TYPES = ['email', 'call', 'meeting'] as const;

/**
 * Median hours from a lead arriving to the first outbound touch, over leads created in
 * the period.
 *
 * Median rather than mean: one lead left for three weeks dragged the mean past every
 * individual response time, which made the number useless for spotting a bad week.
 *
 * Leads with no touch at all are EXCLUDED rather than counted as zero or as infinity —
 * they have no response time, and they are what the Unassigned card is for.
 */
export async function medianResponseHours(range: Range): Promise<number | null> {
  const window = { gte: range.from, lte: range.to };

  const [leads, touches] = await Promise.all([
    // Only leads that were actually touched — the loop below drops the rest anyway.
    // Without this filter every lead in the range was fetched and most were discarded:
    // 16,517 rows pulled to use 6,314 of them.
    db().lead.findMany({
      where: { createdAt: window, activities: { some: { type: { in: [...CONTACT_TYPES] } } } },
      select: { id: true, createdAt: true },
    }),
    db().activity.findMany({
      where: { type: { in: [...CONTACT_TYPES] }, lead: { createdAt: window } },
      select: { leadId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const first = new Map<string, Date>();
  for (const t of touches) {
    if (t.leadId && !first.has(t.leadId)) first.set(t.leadId, t.createdAt);
  }

  const hours: number[] = [];
  for (const l of leads) {
    const touched = first.get(l.id);
    if (!touched) continue;
    const h = (touched.getTime() - l.createdAt.getTime()) / 3_600_000;
    // A touch logged before the lead row is a clock or import artefact, not a negative
    // response time.
    if (h >= 0) hours.push(h);
  }

  if (!hours.length) return null;
  hours.sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/** Leads that arrived in the period and still have no owner. Period-scoped rather than
 *  an all-time backlog so it can be compared against the previous period like every
 *  other card in the band. */
export async function unassignedLeads(range: Range): Promise<number> {
  return db().lead.count({
    where: { createdAt: { gte: range.from, lte: range.to }, ownerEmail: null },
  });
}

/** Repeat submissions folded into an existing lead. Counted from the activity the merge
 *  writes, so it reflects what actually happened rather than a guess at overlap. */
export async function duplicatesMerged(range: Range): Promise<number> {
  return db().activity.count({
    where: {
      summary: DUPLICATE_MERGED_SUMMARY,
      createdAt: { gte: range.from, lte: range.to },
    },
  });
}

/**
 * Won ÷ decided, over deals that CLOSED in the period.
 *
 * Open deals are excluded from the denominator: counting them as not-yet-won drives the
 * rate toward zero on any period where the pipeline grew, which is the opposite of what
 * a growing pipeline means.
 */
export async function winRate(range: Range): Promise<number | null> {
  const closed = await db().opportunity.findMany({
    where: { closedAt: { gte: range.from, lte: range.to } },
    select: { stage: { select: { isWon: true, isLost: true } } },
  });

  let won = 0;
  let decided = 0;
  for (const o of closed) {
    if (o.stage.isWon) {
      won += 1;
      decided += 1;
    } else if (o.stage.isLost) {
      decided += 1;
    }
  }
  return rate(won, decided);
}

/** Mean days from a deal being created to being won, over deals won in the period. Lost
 *  deals are left out — an abandoned deal's "cycle" measures neglect, not sales speed. */
export async function avgCycleDays(range: Range): Promise<number | null> {
  const won = await db().opportunity.findMany({
    where: {
      closedAt: { gte: range.from, lte: range.to },
      stage: { isWon: true },
    },
    select: { createdAt: true, closedAt: true },
  });

  const spans = won
    .map((o) => (o.closedAt!.getTime() - o.createdAt.getTime()) / 86_400_000)
    .filter((d) => d >= 0);

  if (!spans.length) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

/** Leads per weekday for the band's bar chart. Indexed Monday-first, because a week that
 *  starts on Sunday puts the quietest two days at opposite ends of the chart. */
export async function leadsByWeekday(
  range: Range,
  channelId?: string,
): Promise<{ label: string; value: number }[]> {
  // Counted in SQL. This pulled every lead's createdAt — 16,517 rows over a year — to
  // produce seven numbers. Postgres' EXTRACT(DOW) and JavaScript's getUTCDay() both
  // number Sunday 0, and `createdAt` is `timestamp without time zone` holding UTC, so
  // the two agree without any zone conversion.
  const rows = await db().$queryRawUnsafe<{ dow: number | string; total: number | string }[]>(
    `SELECT EXTRACT(DOW FROM "createdAt") AS dow, COUNT(*) AS total
       FROM lead
      WHERE "createdAt" >= $1 AND "createdAt" <= $2
        ${channelId ? `AND "channelId" = $3` : ''}
      GROUP BY 1`,
    ...(channelId ? [range.from, range.to, channelId] : [range.from, range.to]),
  );

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const counts = new Array(7).fill(0) as number[];
  for (const r of rows) {
    // Shift so Monday is 0: a week starting on Sunday puts the quietest two days at
    // opposite ends of the chart.
    counts[(num(r.dow) + 6) % 7] += num(r.total);
  }
  return labels.map((label, i) => ({ label, value: counts[i] }));
}

/** Companies, contacts and the average revenue booked per paying account. */
export async function accountMetrics(range: Range) {
  const window = { gte: range.from, lte: range.to };

  const [companies, contacts, customers, revenueRows] = await Promise.all([
    db().company.count({ where: { createdAt: window } }),
    db().contact.count({ where: { createdAt: window } }),
    db().customer.count({ where: { wonAt: window } }),
    db().revenueEntry.findMany({
      where: { date: window },
      select: { customerId: true, amount: true, currency: true },
    }),
  ]);

  // Averaged over accounts that actually billed in the period, not over every customer
  // on the books — dividing by dormant accounts understates what an active one is worth.
  const money = await currencySettings();
  const perCustomer = new Map<string, number>();
  for (const r of revenueRows) {
    const amount = convert(num(r.amount), r.currency, money);
    if (amount === null) continue;
    perCustomer.set(r.customerId, (perCustomer.get(r.customerId) ?? 0) + amount);
  }
  const totals = [...perCustomer.values()];
  const avgAccountValue = totals.length
    ? totals.reduce((a, b) => a + b, 0) / totals.length
    : null;

  return { companies, contacts, customers, avgAccountValue, payingAccounts: totals.length, currency: money.reporting };
}

/** Share of all companies on the books that are customers. A snapshot, so it ignores the
 *  date range — a company won last year is still a customer today. */
export async function customerShare(): Promise<number | null> {
  const [companies, customers] = await Promise.all([
    db().company.count(),
    db().customer.count({ where: { churnedAt: null } }),
  ]);
  return rate(customers, companies);
}

/**
 * Spend against the budget of the campaigns that were actually live in the period.
 *
 * Only overlapping campaigns count toward the denominator. Summing every budget on the
 * books against one period's spend compared a month of spend to years of budget and
 * reported single-digit pacing on a campaign that had already overspent; the reverse —
 * a long period against a handful of budgets — read as 185%.
 *
 * Null when no live campaign carries a budget: pacing against nothing is not 0%.
 */
export async function budgetPacing(range: Range, channelId?: string): Promise<number | null> {
  const window = { gte: range.from, lte: range.to };

  const [spendRows, budgetRows] = await Promise.all([
    db().marketingSpend.groupBy({
      by: ['currency'],
      where: { date: window, ...(channelId ? { campaign: { is: { channelId } } } : {}) },
      _sum: { amount: true },
    }),
    db().campaign.findMany({
      where: {
        budget: { not: null },
        ...(channelId ? { channelId } : {}),
        // Overlap, treating an open-ended campaign as still running.
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: range.to } }] },
          { OR: [{ endDate: null }, { endDate: { gte: range.from } }] },
        ],
      },
      select: { budget: true, currency: true, budgetPeriod: true, startDate: true, endDate: true },
    }),
  ]);

  // Both sides converted before the division. Spend is billed in the ad account's
  // currency and a budget is quoted in the same one, so today they agree — but a second
  // platform on another currency would silently make this ratio meaningless.
  const money = await currencySettings();
  const spend = sumInReporting(
    spendRows.map((r) => ({ amount: num(r._sum.amount), currency: r.currency })),
    money,
  ).total;
  // A daily budget is an allowance per day, so what the period permitted is that figure
  // times the days the campaign was actually live inside it. Summed raw, thirty days of
  // spend was divided by one day of budget and the gauge read 906.9% — every Meta budget
  // here is a daily one, so the whole reading was out by roughly the length of the range.
  //
  // A lifetime budget covers the entire run and is taken as it stands.
  const budget = sumInReporting(
    budgetRows.map((c) => ({
      amount: num(c.budget) * (c.budgetPeriod === 'daily' ? liveDays(c, range) : 1),
      currency: c.currency,
    })),
    money,
  ).total;

  return rate(spend, budget);
}

const DAY_MS = 86_400_000;

/** Days a campaign was live within the range, both ends included. An open-ended campaign
 *  runs to the end of the range; one that started before it began at the range's start. */
export function liveDays(
  campaign: { startDate: Date | null; endDate: Date | null },
  range: Range,
): number {
  const from = campaign.startDate && campaign.startDate > range.from ? campaign.startDate : range.from;
  const to = campaign.endDate && campaign.endDate < range.to ? campaign.endDate : range.to;
  const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return Math.max(1, days);
}

// ─── per-screen KPI sets ──────────────────────────────────────────────────────
//
// One builder per module screen, so the band is fed from here rather than from figures
// assembled in a page. Each returns the cards plus whatever the page also needs, to
// avoid a second round of the same queries.

/**
 * Leads converted in a period, counted by when they converted rather than when they
 * arrived — a lead created in June and converted in August belongs to August.
 */
async function convertedLeads(range: Range): Promise<number> {
  return db().lead.count({ where: { convertedAt: { gte: range.from, lte: range.to } } });
}

/** Leads: New · Converted · Qualified · Cost per lead · Median response · Unassigned. */
export async function leadsKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  const [now, before, medianNow, medianBefore, unassignedNow, unassignedBefore, weekday, convNow, convBefore] =
    await Promise.all([
      funnel(current),
      funnel(previous),
      medianResponseHours(current),
      medianResponseHours(previous),
      unassignedLeads(current),
      unassignedLeads(previous),
      leadsByWeekday(current),
      convertedLeads(current),
      convertedLeads(previous),
    ]);

  const cards: Kpi[] = [
    { key: 'leads', label: 'New leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    // Semi-qualified rather than qualified. This CRM stamps `qualifiedAt` only when a lead
    // converts — 1,028 leads carry one and 1,025 of those are converted — so a "Qualified"
    // card here printed the Converted card's number beside it, twice, in every period.
    // "Semi-Qualified Lead" is the stage this team actually works: 1,713 leads against 3.
    { key: 'semiQualified', label: 'Semi-qualified', value: now.semiQualified, previous: before.semiQualified, format: 'number', higherIsBetter: true, hint: 'Reached at least semi-qualified — the stage this CRM actually works' },
    { key: 'converted', label: 'Converted', value: convNow, previous: convBefore, format: 'number', higherIsBetter: true, hint: 'Counted on the day the CRM converted them' },
    // Blended, and labelled as such. Spend is Meta's alone — the only paid channel
    // connected — while the lead count is every lead however it arrived, most of them
    // referrals and inbound. Dividing one by the other is a useful number only if the
    // reader knows that is what it is; unlabelled it reads as the price of a Meta lead,
    // which it is not.
    { key: 'cpl', label: 'Cost per lead', value: costPer(now.spend, now.leads), previous: costPer(before.spend, before.leads), format: 'money', currency: now.currency, higherIsBetter: false, hint: 'Blended: all paid spend over all leads, however they arrived' },
    { key: 'response', label: 'Median response', value: medianNow, previous: medianBefore, format: 'duration', higherIsBetter: false, hint: 'First outbound touch; untouched leads excluded' },
    // Reads zero on this workspace and that is the truth, not a gap: the CRM assigns an
    // owner on creation, so all 27,256 imported leads have one. The hint says so rather
    // than leaving a permanent nought looking like a broken query.
    { key: 'unassigned', label: 'Unassigned', value: unassignedNow, previous: unassignedBefore, format: 'number', higherIsBetter: false, hint: 'Leads with no owner. The CRM assigns one on creation, so only leads added here can appear.' },
  ];

  return {
    cards: await comparableDeltas(cards, current, previous),
    current: now,
    weekday,
    qualificationRate: now.leadToSemiQualified,
  };
}

/** CRM: Companies · Contacts · Customers · Avg account value · Duplicates merged. */
export async function crmKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  const [now, before, dupNow, dupBefore, share, weekday] = await Promise.all([
    accountMetrics(current),
    accountMetrics(previous),
    duplicatesMerged(current),
    duplicatesMerged(previous),
    customerShare(),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'companies', label: 'Companies', value: now.companies, previous: before.companies, format: 'number', higherIsBetter: true },
    { key: 'contacts', label: 'Contacts', value: now.contacts, previous: before.contacts, format: 'number', higherIsBetter: true },
    { key: 'customers', label: 'Customers', value: now.customers, previous: before.customers, format: 'number', higherIsBetter: true },
    { key: 'avgAccount', label: 'Avg account value', value: now.avgAccountValue, previous: before.avgAccountValue, format: 'money', currency: now.currency, higherIsBetter: true, hint: 'Averaged over accounts that billed this period' },
    { key: 'duplicates', label: 'Duplicates merged', value: dupNow, previous: dupBefore, format: 'number', higherIsBetter: true, hint: 'Repeat submissions folded into an existing lead' },
  ];

  return { cards: await comparableDeltas(cards, current, previous), customerShare: share, weekday };
}

/** Pipeline: Open deals · Total value · Weighted · Win rate · Avg cycle.
 *
 *  The first three are snapshots with no previous period — a pipeline is a standing
 *  balance, not a flow — so their delta renders as "No prior period" rather than a
 *  fabricated comparison. */
export async function pipelineKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [open, rateNow, ratePrev, cycleNow, cyclePrev, weekday] = await Promise.all([
    openPipeline(),
    winRate(current),
    winRate(previous),
    avgCycleDays(current),
    avgCycleDays(previous),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'openDeals', label: 'Open deals', value: open.count, previous: null, format: 'number', higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    { key: 'totalValue', label: 'Total value', value: open.total, previous: null, format: 'money', currency: open.currency, higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    { key: 'weighted', label: 'Weighted', value: open.weighted, previous: null, format: 'money', currency: open.currency, higherIsBetter: true, hint: 'Value × probability' },
    { key: 'winRate', label: 'Win rate', value: rateNow, previous: ratePrev, format: 'percent', higherIsBetter: true, hint: 'Won ÷ decided, over deals closed this period' },
    { key: 'cycle', label: 'Avg cycle', value: cycleNow, previous: cyclePrev, format: 'days', higherIsBetter: false, hint: 'Created to won, for deals won this period' },
  ];

  return { cards: await comparableDeltas(cards, current, previous), open, winRate: rateNow, weekday };
}

/** Marketing: Spend · Leads · CPL · ROAS · CAC. */
export async function marketingKpis(days: number, channelId?: string) {
  const { current, previous } = rangeFor(days);
  const [now, before, pacing, weekday] = await Promise.all([
    funnel(current, channelId),
    funnel(previous, channelId),
    budgetPacing(current, channelId),
    leadsByWeekday(current, channelId),
  ]);

  const cards: Kpi[] = [
    { key: 'spend', label: 'Spend', value: now.spend, previous: before.spend, format: 'money', currency: now.currency, higherIsBetter: false },
    { key: 'leads', label: 'Leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'cpl', label: 'CPL', value: costPer(now.spend, now.leads), previous: costPer(before.spend, before.leads), format: 'money', currency: now.currency, higherIsBetter: false },
    // The blended wording is only true unfiltered. Scoped to a channel these ARE that
    // channel's own figures, and calling them blended would describe the opposite of what
    // is on screen.
    {
      key: 'roas', label: 'ROAS', value: now.roas, previous: before.roas, format: 'ratio', higherIsBetter: true,
      hint: channelId
        ? 'This channel’s new business over its own spend'
        : 'Blended: new business over all paid spend. Meta is the only paid channel, and most revenue arrives by referral and inbound — this is not Meta’s return',
    },
    {
      key: 'cac', label: 'CAC', value: now.cac, previous: before.cac, format: 'money', currency: now.currency, higherIsBetter: false,
      hint: channelId
        ? 'This channel’s spend over the customers it brought'
        : 'Blended: all paid spend over every new customer, however they arrived',
    },
  ];

  return { cards: await comparableDeltas(cards, current, previous), current: now, budgetPacing: pacing, weekday };
}

/** Analytics: Sessions · Visitor→lead · Lead→qualified · Opp→customer · Revenue. */
export async function analyticsKpis(days: number) {
  const { current, previous } = rangeFor(days);
  const [now, before, weekday] = await Promise.all([
    funnel(current),
    funnel(previous),
    leadsByWeekday(current),
  ]);

  // Pageviews and users were synced daily from GA4 and never read — the band showed
  // sessions alone while two of the three metrics the provider fetches sat unused.
  const [views, viewsBefore, people, peopleBefore] = await Promise.all([
    siteMetric('pageviews', current),
    siteMetric('pageviews', previous),
    siteMetric('users', current),
    siteMetric('users', previous),
  ]);

  const cards: Kpi[] = [
    { key: 'sessions', label: 'Sessions', value: now.visitors, previous: before.visitors, format: 'number', higherIsBetter: true },
    { key: 'users', label: 'Users', value: people, previous: peopleBefore, format: 'number', higherIsBetter: true },
    { key: 'pageviews', label: 'Pageviews', value: views, previous: viewsBefore, format: 'number', higherIsBetter: true },
    { key: 'visitorToLead', label: 'Visitor→lead', value: now.visitorToLead, previous: before.visitorToLead, format: 'percent', higherIsBetter: true },
    { key: 'leadToQualified', label: 'Lead→qualified', value: now.leadToQualified, previous: before.leadToQualified, format: 'percent', higherIsBetter: true },
    { key: 'oppToCustomer', label: 'Opp→customer', value: now.opportunityToCustomer, previous: before.opportunityToCustomer, format: 'percent', higherIsBetter: true },
    { key: 'revenue', label: 'Revenue', value: now.revenue, previous: before.revenue, format: 'money', currency: now.currency, higherIsBetter: true },
  ];

  return { cards: await comparableDeltas(cards, current, previous), current: now, weekday };
}

// ─── per-screen trend series ──────────────────────────────────────────────────
//
// Bucketed the same way as trend(): one query, grouped in JS, because the date columns
// are DATE and a per-driver cast is not worth it at 365 rows.

export function bucketKey(d: Date, bucket: 'day' | 'month') {
  return bucket === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
}

/**
 * Every bucket across the range, in order, whether or not it has data.
 *
 * Without this a series only carries the buckets that happen to have rows, so a range
 * where all the activity landed on one day drew a single floating dot instead of a flat
 * line with a spike — it read as a broken chart rather than as "this all happened at
 * once". A gap in a time series means zero, and the axis has to say so.
 */
function emptyBuckets(range: Range, bucket: 'day' | 'month'): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor <= range.to) {
    keys.push(bucketKey(cursor, bucket));
    if (bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // A month bucket can repeat when the range starts mid-month.
  return [...new Set(keys)];
}

/** Companies and contacts created per bucket — what the CRM screen's "Accounts added"
 *  chart draws. Counted together because the screen treats them as one population. */
export async function accountsTrend(range: Range, bucket: 'day' | 'month') {
  const window = { gte: range.from, lte: range.to };

  const [companies, contacts] = await Promise.all([
    db().company.findMany({ where: { createdAt: window }, select: { createdAt: true } }),
    db().contact.findMany({ where: { createdAt: window }, select: { createdAt: true } }),
  ]);

  const buckets = new Map<string, { date: string; accounts: number }>(
    emptyBuckets(range, bucket).map((k) => [k, { date: k, accounts: 0 }]),
  );
  const at = (d: Date) => {
    const k = bucketKey(d, bucket);
    let row = buckets.get(k);
    if (!row) {
      row = { date: k, accounts: 0 };
      buckets.set(k, row);
    }
    return row;
  };

  for (const c of companies) at(c.createdAt).accounts += 1;
  for (const c of contacts) at(c.createdAt).accounts += 1;

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Deal value created per bucket, by the date the opportunity was opened — "pipeline
 *  created", not pipeline closed. */
export async function pipelineTrend(range: Range, bucket: 'day' | 'month') {
  // Deal values are held in the currency the deal was written in — 137 of the last
  // year's are INR against 4,800 USD — and this series is rendered as money in the
  // reporting currency, so each value is converted before it is added.
  const rows = await db().opportunity.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true, value: true, currency: true },
  });

  const fx = await currencySettings();
  const unconverted = new Set<string>();

  const buckets = new Map<string, { date: string; created: number }>(
    emptyBuckets(range, bucket).map((k) => [k, { date: k, created: 0 }]),
  );
  for (const r of rows) {
    const converted = convert(num(r.value), r.currency, fx);
    if (converted === null) {
      unconverted.add(r.currency ?? 'unknown');
      continue;
    }
    const k = bucketKey(r.createdAt, bucket);
    const row = buckets.get(k) ?? { date: k, created: 0 };
    row.created += converted;
    buckets.set(k, row);
  }
  if (unconverted.size) {
    console.warn(`[metrics] pipelineTrend: no exchange rate for ${[...unconverted].join(', ')}; those deals are missing from the chart.`);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Share of customers who have billed more than once. A snapshot: it asks whether an
 *  account came back at all, which no single period can answer. */
export async function repeatCustomerRate(): Promise<number | null> {
  const rows = await db().revenueEntry.groupBy({
    by: ['customerId'],
    _count: { _all: true },
  });
  if (!rows.length) return null;
  const repeat = rows.filter((r) => r._count._all > 1).length;
  return rate(repeat, rows.length);
}

/**
 * What actually produced each headline figure in a period.
 *
 * Provenance existed in the data — metric_snapshot.source, campaign.source — but only
 * the Analytics page ever read it, so a page mixing reported spend with seeded visitors
 * looked completely uniform. This is what the SourceLine under each page header renders.
 *
 * Returns a list per figure rather than one label: real spend alongside a seeded
 * campaign is honestly two sources, and collapsing that to one would be the same lie
 * the badges exist to prevent.
 */
export async function provenance(range: Range): Promise<Record<string, string[]>> {
  const window = { gte: range.from, lte: range.to };

  const [sessionSources, spendCampaigns, revenueCount, leadCount] = await Promise.all([
    db().metricSnapshot.findMany({
      where: { metricKey: 'sessions', date: window },
      select: { source: true },
      distinct: ['source'],
    }),
    db().campaign.findMany({
      where: { spend: { some: { date: window, amount: { gt: 0 } } } },
      select: { source: true },
      distinct: ['source'],
    }),
    db().revenueEntry.count({ where: { date: window } }),
    db().lead.count({ where: { createdAt: window } }),
  ]);

  // A campaign with no source was written by the seeder, whatever its channel says.
  const spend = spendCampaigns.map((c) => c.source ?? DEMO_SOURCE);

  return {
    visitors: sessionSources.map((r) => r.source),
    spend,
    // Leads and revenue are Growth Center's own records — no platform reports them.
    leads: leadCount ? [INTERNAL_SOURCE] : [],
    revenue: revenueCount ? [INTERNAL_SOURCE] : [],
  };
}
