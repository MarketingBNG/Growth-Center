import { db } from './prisma.ts';
import { num, rate } from './calc.ts';

// SEO reads its own tables rather than MetricSnapshot: a keyword's position on a date is
// an attribute of the keyword, and SeoKeywordRanking already stores that history. The
// metrics layer holds site-wide series, not per-entity attributes with their own shape.

/**
 * Nothing writes SeoKeyword, SeoKeywordRanking or SeoPage except the seeder.
 *
 * The Semrush provider writes three domain-level numbers into MetricSnapshot
 * (organic_keywords, organic_traffic, organic_traffic_value) and touches none of these
 * tables. The page's "seeded" warning used to key off Semrush's connection state, so
 * connecting it removed the warning without replacing a single figure — the page would
 * have started presenting invented rankings as live.
 *
 * Flip this to true in the same change that makes an ingestion write these tables.
 */
export const SEO_HAS_LIVE_SOURCE = false;

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

  return {
    website,
    keywords: tracked,
    pages: pages.map((p) => ({
      id: p.id,
      url: p.url,
      title: p.title,
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
