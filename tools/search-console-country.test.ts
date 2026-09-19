import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchConsole,
  countryKey,
  splitCountryKey,
} from '../lib/integrations/providers/search-console.ts';
import type { MetricPoint } from '../lib/integrations/types.ts';

// Search Console's US/India split.
//
// The whole risk in this feature is not the fetching, it is where the rows land. Three
// readers in this codebase select Search Console metrics by `entityType` alone and never
// narrow by `entityId`:
//
//   readSearchTrend (lib/analytics/seo.ts) takes every `site` row for a day and ASSIGNS
//   `day.clicks = value`, so two rows for one day means the chart shows whichever was
//   written last.
//
//   the traffic totals there SUM every `seo_keyword` row there is.
//
//   writeSeoRows (lib/integrations/writers/seo.ts) filters `p.entityType === 'seo_page'`
//   and mints a SeoPage from each.
//
// So a country breakdown carried as extra rows under the existing types would corrupt the
// trend, double the totals, and duplicate the page table — silently, and only once real
// data arrived. These tests exist to hold the country rows in types of their own.

// ── entity keys ──────────────────────────────────────────────────────────────────────

test('a country-scoped key round-trips', () => {
  const key = countryKey('usa', 'https://usaindiacfo.com/services/');
  assert.equal(key, 'usa|https://usaindiacfo.com/services/');
  assert.deepEqual(splitCountryKey(key), {
    country: 'usa',
    entity: 'https://usaindiacfo.com/services/',
  });
});

// A pipe is legal in a URL and Google returns it unencoded in query rows. Splitting on
// the last separator, or on all of them, would truncate the URL and quietly merge two
// pages into one row.
test('a pipe inside the URL does not break the split', () => {
  const url = 'https://usaindiacfo.com/blog/?utm=a|b';
  const { country, entity } = splitCountryKey(countryKey('ind', url));
  assert.equal(country, 'ind');
  assert.equal(entity, url, 'the split is on the FIRST pipe, not the last');
});

test('a key with no separator yields no entity rather than throwing', () => {
  assert.deepEqual(splitCountryKey('usa'), { country: 'usa', entity: '' });
});

// ── the sync ─────────────────────────────────────────────────────────────────────────

/** One Search Console row. */
const row = (keys: string[], clicks: number, impressions: number, position = 4) => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

/**
 * Answers the token endpoint and then every searchAnalytics call, choosing a body from
 * the dimensions and country filter the provider asked for. Returns the calls it saw so a
 * test can assert on what was requested, not only on what came back.
 */
function stubGoogle() {
  const calls: { dimensions: string[]; country: string | null }[] = [];

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);

    if (href.includes('oauth2.googleapis.com') || href.includes('token')) {
      return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
    }

    const body = JSON.parse(String(init?.body ?? '{}')) as {
      dimensions?: string[];
      dimensionFilterGroups?: { filters: { dimension: string; expression: string }[] }[];
    };
    const dimensions = body.dimensions ?? [];
    const country =
      body.dimensionFilterGroups?.[0]?.filters?.find((f) => f.dimension === 'country')
        ?.expression ?? null;
    calls.push({ dimensions, country });

    const shape = dimensions.join(',');
    let rows: unknown[] = [];

    if (country) {
      // Deliberately different numbers per country, so a test can tell them apart.
      const scale = country === 'usa' ? 10 : 1;
      if (shape === 'date') rows = [row(['2026-09-01'], 10 * scale, 100 * scale)];
      if (shape === 'query') rows = [row(['us india tax'], 5 * scale, 50 * scale)];
      if (shape === 'page') rows = [row(['https://usaindiacfo.com/'], 7 * scale, 70 * scale)];
    } else if (shape === 'date') {
      rows = [row(['2026-09-01'], 11, 110)];
    } else if (shape === 'query,date') {
      rows = [row(['us india tax', '2026-09-01'], 6, 60)];
    } else if (shape === 'page') {
      rows = [row(['https://usaindiacfo.com/'], 8, 80)];
    } else if (shape === 'query,page') {
      rows = [row(['us india tax', 'https://usaindiacfo.com/'], 6, 60)];
    } else if (shape === 'date,device') {
      rows = [
        row(['2026-09-01', 'MOBILE'], 6, 60),
        row(['2026-09-01', 'DESKTOP'], 5, 50),
      ];
    }

    return new Response(JSON.stringify({ rows }), { status: 200 });
  }) as typeof fetch;

  return calls;
}

async function runSync(): Promise<{ points: MetricPoint[]; calls: ReturnType<typeof stubGoogle> }> {
  const original = global.fetch;
  const calls = stubGoogle();
  try {
    const points = await searchConsole.sync!(
      JSON.stringify({ refreshToken: 'r' }),
      { siteUrl: 'sc-domain:usaindiacfo.com' },
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') },
    );
    return { points, calls };
  } finally {
    global.fetch = original;
  }
}

const of = (points: MetricPoint[], entityType: string) =>
  points.filter((p) => p.entityType === entityType);

test('both markets are asked for, one country at a time', async () => {
  const { calls } = await runSync();
  const countries = [...new Set(calls.map((c) => c.country).filter(Boolean))].sort();
  assert.deepEqual(countries, ['ind', 'usa']);

  // Per country: a daily series, queries and pages.
  for (const country of ['usa', 'ind']) {
    const shapes = calls.filter((c) => c.country === country).map((c) => c.dimensions.join(','));
    assert.deepEqual(shapes.sort(), ['date', 'page', 'query']);
  }
});

test('country rows land in their own entity types, never in site or seo_page', async () => {
  const { points } = await runSync();

  assert.ok(of(points, 'site_country').length, 'no site_country rows were written');
  assert.ok(of(points, 'seo_page_country').length, 'no seo_page_country rows were written');
  assert.ok(of(points, 'seo_keyword_country').length, 'no seo_keyword_country rows were written');

  // The load-bearing assertion. `site` carries one row per metric per day and no more:
  // readSearchTrend assigns rather than sums, so a second row for 2026-09-01 would mean
  // the chart silently reports one country's clicks as the whole site's.
  const perDayPerKey = new Map<string, number>();
  for (const p of of(points, 'site')) {
    const k = `${p.metricKey}@${p.date.toISOString().slice(0, 10)}`;
    perDayPerKey.set(k, (perDayPerKey.get(k) ?? 0) + 1);
  }
  for (const [k, n] of perDayPerKey) {
    assert.equal(n, 1, `${k} has ${n} site rows; readSearchTrend would report the last one`);
  }

  // writeSeoRows mints a SeoPage per `seo_page` point, so a country row reaching that
  // type would put the same URL in the page table two or three times over.
  const pageIds = of(points, 'seo_page').map((p) => p.entityId);
  assert.ok(
    pageIds.every((id) => !id?.includes('|')),
    'a country-scoped id reached seo_page and would duplicate the page table',
  );

  const keywordIds = of(points, 'seo_keyword').map((p) => p.entityId);
  assert.ok(
    keywordIds.every((id) => !id?.includes('|')),
    'a country-scoped id reached seo_keyword and would double the traffic totals',
  );
});

test('the two markets are told apart, and carry the country in their payload', async () => {
  const { points } = await runSync();

  const clicks = (type: string, id: string) =>
    Number(points.find((p) => p.entityType === type && p.entityId === id && p.metricKey === 'clicks')?.value);

  assert.equal(clicks('seo_page_country', countryKey('usa', 'https://usaindiacfo.com/')), 70);
  assert.equal(clicks('seo_page_country', countryKey('ind', 'https://usaindiacfo.com/')), 7);

  const usPage = points.find(
    (p) => p.entityType === 'seo_page_country' && p.entityId === countryKey('usa', 'https://usaindiacfo.com/'),
  );
  assert.deepEqual(usPage?.entityMeta, { url: 'https://usaindiacfo.com/', country: 'usa' });
  assert.equal(usPage?.entityLabel, 'https://usaindiacfo.com/', 'the label is the URL, not the composite key');
});

test('CTR is stored as a percentage, as the rest of the app expects', async () => {
  const { points } = await runSync();
  const ctr = points.find(
    (p) => p.entityType === 'seo_page_country' && p.entityId === countryKey('usa', 'https://usaindiacfo.com/') && p.metricKey === 'ctr',
  );
  // 70 clicks on 700 impressions is a ratio of 0.1, which Google sends as 0.1 and this
  // table stores as 10.
  assert.equal(Number(ctr?.value), 10);
});

test('device is a daily series, lower-cased, with no country filter', async () => {
  const { points, calls } = await runSync();

  const device = calls.find((c) => c.dimensions.join(',') === 'date,device');
  assert.ok(device, 'the device breakdown was never requested');
  assert.equal(device.country, null, 'device is site-wide; filtering it by country would undercount');

  const ids = [...new Set(of(points, 'site_device').map((p) => p.entityId))].sort();
  assert.deepEqual(ids, ['desktop', 'mobile'], 'Google sends MOBILE; the store keeps one casing');
});
