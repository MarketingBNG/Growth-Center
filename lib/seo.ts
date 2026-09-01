import { db } from './prisma.ts';
import { TAGS, cached } from './cache.ts';
import { num, rate } from './calc.ts';

// SEO reads its own tables rather than MetricSnapshot: a keyword's position on a date is
// an attribute of the keyword, and SeoKeywordRanking already stores that history. The
// metrics layer holds site-wide series, not per-entity attributes with their own shape.

/**
 * Which rows in the SEO tables came from a provider, and which the seeder invented.
 *
 * This used to be a hardcoded `false`, because nothing but the seeder wrote SeoKeyword,
 * SeoKeywordRanking or SeoPage. Search Console does, so the answer is read from the rows
 * themselves via their `source` column rather than asserted in code — a connection that
 * has never synced must not be allowed to remove the warning. Per row, not per table: a live
 * ranking and a seeded one can sit side by side while the first sync backfills, and the
 * page has to be able to say which is which.
 */
export function seoLiveness(rows: { source: string | null }[]) {
  const live = rows.filter((r) => r.source !== null).length;
  return { live, seeded: rows.length - live, hasLive: live > 0, allLive: rows.length > 0 && live === rows.length };
}

/** Readings kept per keyword for the trend line. A month of daily positions is enough to
 *  show a direction and small enough to load for every keyword at once. */
const HISTORY_POINTS = 30;

async function readSeoOverview() {
  // The traffic totals key off `entityType: 'seo_keyword'`, not off the website, so they
  // do not need to wait for the website lookup — issuing them together turns three
  // sequential round trips into two. At ~250ms a trip that is a third of the page's wait.
  const [website, traffic] = await Promise.all([
    db().website.findFirst({ select: { id: true, domain: true, name: true } }),
    // What each keyword actually earned. Search Console reports it per query and the
    // table showed none of it, while four columns it cannot report — volume, difficulty,
    // CPC, intent — took up half the width printing an em dash on every row.
    db().metricSnapshot.groupBy({
      by: ['entityId', 'metricKey'],
      where: { entityType: 'seo_keyword', metricKey: { in: ['clicks', 'impressions'] } },
      _sum: { value: true },
    }),
  ]);
  if (!website) return null;

  const [keywords, pages] = await Promise.all([
    db().seoKeyword.findMany({
      where: { websiteId: website.id },
      include: {
        // Enough readings to draw the line, newest first. Two was enough to answer
        // "moved up 3" and nothing more, so the trend column had no history to plot.
        rankings: { orderBy: { date: 'desc' }, take: HISTORY_POINTS },
      },
    }),
    db().seoPage.findMany({ where: { websiteId: website.id }, orderBy: { clicks: 'desc' } }),
  ]);

  const earned = new Map<string, { clicks: number; impressions: number }>();
  for (const row of traffic) {
    const key = row.entityId ?? '';
    const entry = earned.get(key) ?? { clicks: 0, impressions: 0 };
    if (row.metricKey === 'clicks') entry.clicks = num(row._sum.value);
    if (row.metricKey === 'impressions') entry.impressions = num(row._sum.value);
    earned.set(key, entry);
  }

  const tracked = keywords.map((k) => {
    const latest = k.rankings[0] ?? null;
    const prior = k.rankings[1] ?? null;
    const seen = earned.get(k.keyword) ?? { clicks: 0, impressions: 0 };
    // Lower is better, so a fall in position number is an improvement.
    const move = latest && prior ? prior.position - latest.position : null;
    return {
      id: k.id,
      keyword: k.keyword,
      country: k.country,
      source: k.source,
      searchVolume: k.searchVolume,
      difficulty: k.difficulty,
      cpc: k.cpc === null ? null : num(k.cpc),
      intent: k.intent,
      position: latest?.position ?? null,
      move,
      clicks: seen.clicks,
      impressions: seen.impressions,
      /// Oldest first, which is the direction a line is read.
      history: [...k.rankings].reverse().map((r) => r.position),
      lastChecked: latest?.date ?? null,
    };
  });

  // Ordered by what the keyword actually earned. The previous order was `searchVolume`
  // descending — a column Search Console never fills, so every row sorted equal and the
  // list opened on whichever 1,760 rows the database happened to return first.
  tracked.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);

  const ranked = tracked.filter((k) => k.position !== null);
  const totals = {
    keywords: tracked.length,
    inTop3: ranked.filter((k) => (k.position ?? 99) <= 3).length,
    inTop10: ranked.filter((k) => (k.position ?? 99) <= 10).length,
    inTop100: ranked.length,
    improved: tracked.filter((k) => (k.move ?? 0) > 0).length,
    declined: tracked.filter((k) => (k.move ?? 0) < 0).length,
    // Most keywords have a single reading and so no movement at all. Counted here so the
    // page can say what the up/down figures are out of, rather than implying every
    // tracked keyword held still.
    compared: tracked.filter((k) => k.move !== null).length,
    clicks: pages.reduce((t, p) => t + p.clicks, 0),
    impressions: pages.reduce((t, p) => t + p.impressions, 0),
  };

  const issues = pages.flatMap((p) => {
    const list = Array.isArray(p.issues) ? (p.issues as { code?: string; severity?: string; message?: string }[]) : [];
    return list.map((i) => ({ url: p.url, code: i.code ?? 'unknown', severity: i.severity ?? 'low', message: i.message ?? '' }));
  });

  // Keywords and pages are judged together: the page's warning covers both tables, and a
  // provider that populated one but not the other is still only partly live.
  const liveness = seoLiveness([...keywords, ...pages]);

  return {
    website,
    liveness,
    keywords: tracked,
    pages: pages.map((p) => ({
      id: p.id,
      url: p.url,
      title: p.title,
      source: p.source,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: p.ctr,
      avgPosition: p.avgPosition,
      issueCount: Array.isArray(p.issues) ? (p.issues as unknown[]).length : 0,
    })),
    issues,
    totals: { ...totals, ctr: rate(totals.clicks, totals.impressions) },
  };
}


/**
 * Daily search performance from Search Console, for the trend on the SEO page.
 *
 * The page's Clicks and Impressions tiles are a single all-time total taken from the page
 * table, so nothing on the screen showed movement — while the sync had been storing
 * clicks, impressions, CTR and average position per day all along.
 *
 * Clicks and impressions share a chart because they share a unit. CTR and position do
 * not, and are returned as period figures rather than being forced onto the same axis:
 * position is an average, never a sum, and lower is better.
 */
async function readSearchTrend(days = 28) {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);

  const rows = await db().metricSnapshot.findMany({
    where: {
      entityType: 'site',
      metricKey: { in: ['search_clicks', 'search_impressions', 'search_ctr', 'search_position'] },
      date: { gte: from, lte: to },
    },
    select: { metricKey: true, value: true, date: true },
    orderBy: { date: 'asc' },
  });
  if (!rows.length) return null;

  // Position is kept beside the chart rows, not on them: the chart plots clicks and
  // impressions, and an extra nullable key on each point does not fit a plotted series.
  const byDay = new Map<string, { date: string; clicks: number; impressions: number }>();
  const positionByDay = new Map<string, number>();

  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? { date: key, clicks: 0, impressions: 0 };
    if (r.metricKey === 'search_clicks') day.clicks = Number(r.value);
    if (r.metricKey === 'search_impressions') day.impressions = Number(r.value);
    if (r.metricKey === 'search_position') positionByDay.set(key, Number(r.value));
    // search_ctr is read back off clicks and impressions rather than averaged: see below.
    byDay.set(key, day);
  }

  const data = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const clicks = data.reduce((t, d) => t + d.clicks, 0);
  const impressions = data.reduce((t, d) => t + d.impressions, 0);

  // Weighted by impressions, not a plain mean of the daily figures. A quiet Sunday with
  // twelve impressions counted as much as a Tuesday with three thousand, so the period
  // CTR and average position were both a mean of ratios rather than the site's actual
  // ratio over the window — the same figure Search Console reports for the period.
  let positionWeight = 0;
  let positionTotal = 0;
  for (const d of data) {
    const position = positionByDay.get(d.date);
    if (position === undefined) continue;
    // A day with no impressions has no position to weight; keep it out entirely rather
    // than letting a zero weight drop it silently to the same effect.
    const weight = d.impressions;
    if (weight <= 0) continue;
    positionTotal += position * weight;
    positionWeight += weight;
  }

  return {
    data,
    clicks,
    impressions,
    ctr: rate(clicks, impressions),
    position: positionWeight ? positionTotal / positionWeight : null,
    days: data.length,
  };
}

/**
 * Keywords, rankings and pages are written once a day by the Search Console sync, so the
 * SEO page was paying three round trips per view to redraw figures that had not moved.
 * Both reads drop on the `seo` tag when a sync writes.
 */
export const seoOverview = cached('seo:overview', [TAGS.seo], readSeoOverview);
export const searchTrend = cached('seo:search-trend', [TAGS.seo], readSearchTrend);
