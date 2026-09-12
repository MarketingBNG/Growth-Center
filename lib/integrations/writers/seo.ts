import { db } from '../../prisma.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import type { IntegrationProvider, MetricPoint } from '../types.ts';
import { bulkUpsert, meta, str } from '../persist.ts';

/**
 * Turns `seo_keyword` and `seo_page` points into the SEO tables.
 *
 * Until this existed nothing but the seeder wrote SeoKeyword, SeoKeywordRanking or
 * SeoPage, so the SEO page stayed fully seeded no matter what was connected. Rows written
 * here carry `source`, so the page can tell a reported ranking from an invented one
 * sitting in the same table.
 */
export async function writeSeoRows(
  provider: IntegrationProvider,
  config: Record<string, unknown>,
  points: MetricPoint[],
): Promise<number> {
  const keywordPoints = points.filter((p) => p.entityType === 'seo_keyword' && p.entityId);
  const pagePoints = points.filter((p) => p.entityType === 'seo_page' && p.entityId);
  if (!keywordPoints.length && !pagePoints.length) return 0;

  // Every SEO row hangs off a Website. Prefer the domain the provider was configured
  // with; fall back to whatever site already exists, so a provider without such a setting
  // lands on the existing site rather than creating a second one.
  const configured = typeof config.siteUrl === 'string' ? config.siteUrl : '';
  const domain = configured
    .replace(/^sc-domain:/, '')
    .replace(/^https?:[/][/]/, '')
    .replace(/[/].*$/, '')
    .trim();

  const website = domain
    ? await db().website.upsert({
        where: { domain },
        create: { domain, name: domain },
        update: {},
        select: { id: true },
      })
    : await db().website.findFirst({ select: { id: true } });
  if (!website) return 0;

  let written = 0;

  // ── keywords: one row per phrase, one ranking row per phrase-day ─────────────────
  type Ranking = { date: Date; position: number; url: string | null };
  const byKeyword = new Map<string, Ranking[]>();

  for (const p of keywordPoints) {
    if (p.metricKey !== 'position') continue;
    const keyword = p.entityId as string;
    const rankings = byKeyword.get(keyword) ?? [];
    // Which page holds the position. The column existed and stayed null on all 5,000
    // rows, so the table could say a term ranked third without saying third with what.
    rankings.push({ date: p.date, position: Math.round(p.value), url: str(meta(p).url) });
    byKeyword.set(keyword, rankings);
  }

  // Three statements rather than one per row. A loop of upserts here was 1,760 keyword
  // round trips plus 5,000 ranking ones against Neon — the same shape of mistake
  // writePoints was written to avoid, and it grows with the site.
  //
  // searchVolume, difficulty and cpc are deliberately left unset. Search Console does not
  // report them, and a number invented to fill the column is exactly the kind of figure
  // this app labels rather than fabricates.
  const keywords = [...byKeyword.keys()];
  if (keywords.length) {
    await bulkUpsert(
      'seo_keyword',
      ['websiteId', 'keyword', 'country', 'source'],
      keywords.map((keyword) => [website.id, keyword, 'us', provider.id]),
      '"websiteId", "keyword", "country"',
      {},
      false,
    );

    // Read back rather than returned by the upsert: seo_keyword has no externalId, which
    // is the only column bulkUpsert can hand back to identify a row.
    const idByKeyword = new Map<string, string>();
    const LOOKUP_CHUNK = 1000;
    for (let i = 0; i < keywords.length; i += LOOKUP_CHUNK) {
      const rows = await db().seoKeyword.findMany({
        where: { websiteId: website.id, country: 'us', keyword: { in: keywords.slice(i, i + LOOKUP_CHUNK) } },
        select: { id: true, keyword: true },
      });
      for (const r of rows) idByKeyword.set(r.keyword, r.id);
    }

    const rankingRows: unknown[][] = [];
    for (const [keyword, rankings] of byKeyword) {
      const keywordId = idByKeyword.get(keyword);
      if (!keywordId) continue;
      for (const ranking of rankings) {
        rankingRows.push([keywordId, ranking.date, ranking.position, ranking.url]);
      }
    }

    const touched = await bulkUpsert(
      'seo_keyword_ranking',
      ['keywordId', 'date', 'position', 'url'],
      rankingRows,
      '"keywordId", "date"',
      { date: 'date', position: 'int' },
      false,
    );
    written += touched.length;
  }

  // ── pages: one current row per URL ───────────────────────────────────────────────
  const byPage = new Map<string, Record<string, number>>();
  for (const p of pagePoints) {
    const url = p.entityId as string;
    const entry = byPage.get(url) ?? {};
    entry[p.metricKey] = p.value;
    byPage.set(url, entry);
  }

  const pageRows = [...byPage].map(([url, m]) => [
    website.id,
    url,
    Math.round(m.clicks ?? 0),
    Math.round(m.impressions ?? 0),
    m.ctr ?? 0,
    m.position ?? 0,
    provider.id,
  ]);
  if (pageRows.length) {
    const touched = await bulkUpsert(
      'seo_page',
      ['websiteId', 'url', 'clicks', 'impressions', 'ctr', 'avgPosition', 'source'],
      pageRows,
      '"websiteId", "url"',
      // Float columns, not Decimal — casting to numeric would rely on an implicit
      // conversion on the way in.
      { clicks: 'int', impressions: 'int', ctr: 'double precision', avgPosition: 'double precision' },
    );
    written += touched.length;
  }

  return written;
}

/**
 * Attaches PageSpeed's Lighthouse findings to the pages Search Console already found.
 *
 * An UPDATE against existing rows, never an upsert, and this is the whole point of it
 * being a separate materialiser rather than more `seo_page` points. `writeSeoRows` builds
 * a full row per URL and defaults clicks, impressions, ctr and avgPosition to zero — so a
 * PageSpeed pass routed through it would have wiped Search Console's traffic figures off
 * every page it measured and taken the `source` column with them. PageSpeed discovers no
 * pages of its own; a URL it measured that is not already in the table has nothing to say
 * about traffic and is skipped rather than invented.
 */
export async function writeWebVitals(points: MetricPoint[]): Promise<number> {
  const issuePoints = points.filter((p) => p.entityType === 'web_vitals_issues' && p.entityId);
  if (!issuePoints.length) return 0;

  // Last write wins within a pass — a URL cannot legitimately appear twice, and if it does
  // the later measurement is the current one.
  const byUrl = new Map<string, unknown>();
  for (const p of issuePoints) {
    const issues = meta(p).issues;
    if (Array.isArray(issues)) byUrl.set(p.entityId as string, issues);
  }
  if (!byUrl.size) return 0;

  const existing = await db().seoPage.findMany({
    where: { url: { in: [...byUrl.keys()] } },
    select: { id: true, url: true },
  });

  let written = 0;
  for (const row of existing) {
    const issues = byUrl.get(row.url);
    if (issues === undefined) continue;
    await db().seoPage.update({
      where: { id: row.id },
      // `issues` only. Every other column on this row belongs to Search Console.
      data: { issues: issues as Prisma.InputJsonValue },
    });
    written += 1;
  }

  return written;
}
