import { db } from './prisma.ts';
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

export async function seoOverview() {
  const website = await db().website.findFirst({ select: { id: true, domain: true, name: true } });
  if (!website) return null;

  const [keywords, pages] = await Promise.all([
    db().seoKeyword.findMany({
      where: { websiteId: website.id },
      include: {
        // Two most recent readings: the latest position, and the one before it, which is
        // what makes "moved up 3" answerable without loading the whole history.
        rankings: { orderBy: { date: 'desc' }, take: 2 },
      },
      orderBy: { searchVolume: 'desc' },
    }),
    db().seoPage.findMany({ where: { websiteId: website.id }, orderBy: { clicks: 'desc' } }),
  ]);

  const tracked = keywords.map((k) => {
    const latest = k.rankings[0] ?? null;
    const prior = k.rankings[1] ?? null;
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
      lastChecked: latest?.date ?? null,
    };
  });

  const ranked = tracked.filter((k) => k.position !== null);
  const totals = {
    keywords: tracked.length,
    inTop3: ranked.filter((k) => (k.position ?? 99) <= 3).length,
    inTop10: ranked.filter((k) => (k.position ?? 99) <= 10).length,
    inTop100: ranked.length,
    improved: tracked.filter((k) => (k.move ?? 0) > 0).length,
    declined: tracked.filter((k) => (k.move ?? 0) < 0).length,
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

/** Position history for one keyword, oldest first, for the sparkline. */
export async function keywordHistory(keywordId: string) {
  const rows = await db().seoKeywordRanking.findMany({
    where: { keywordId },
    orderBy: { date: 'asc' },
    select: { date: true, position: true },
  });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), position: r.position }));
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
export async function searchTrend(days = 28) {
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

  const byDay = new Map<string, { date: string; clicks: number; impressions: number }>();
  let ctrTotal = 0;
  let ctrDays = 0;
  let positionTotal = 0;
  let positionDays = 0;

  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? { date: key, clicks: 0, impressions: 0 };
    if (r.metricKey === 'search_clicks') day.clicks = Number(r.value);
    if (r.metricKey === 'search_impressions') day.impressions = Number(r.value);
    if (r.metricKey === 'search_ctr') {
      ctrTotal += Number(r.value);
      ctrDays += 1;
    }
    if (r.metricKey === 'search_position') {
      positionTotal += Number(r.value);
      positionDays += 1;
    }
    byDay.set(key, day);
  }

  const data = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    data,
    clicks: data.reduce((t, d) => t + d.clicks, 0),
    impressions: data.reduce((t, d) => t + d.impressions, 0),
    ctr: ctrDays ? ctrTotal / ctrDays : null,
    position: positionDays ? positionTotal / positionDays : null,
    days: data.length,
  };
}
