import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRAWL_ISSUE_FLAGS,
  bingWebmaster,
  decodeCrawlIssues,
  parseBingDate,
} from '../lib/integrations/providers/bing-webmaster.ts';
import { getProvider } from '../lib/integrations/registry.ts';
import type { MetricPoint } from '../lib/integrations/types.ts';

// Bing Webmaster Tools.
//
// This provider has never run against the live API — there is no key for this account —
// so these tests carry more weight than usual. They cover the three things that would be
// wrong silently rather than loudly: the crawl-issue bitmask, WCF's date encoding, and
// which entity types the rows land in.

// ── the crawl issue bitmask ──────────────────────────────────────────────────────────

test('the flag values are the ones the enum documents', () => {
  assert.deepEqual(
    CRAWL_ISSUE_FLAGS.map(([bit]) => bit),
    [1, 2, 4, 8, 16, 32, 64, 128, 256],
  );
});

test('a single flag decodes to its name', () => {
  assert.deepEqual(decodeCrawlIssues(32), ['Contains malware']);
  assert.deepEqual(decodeCrawlIssues(4), ['HTTP 4xx']);
});

// The whole reason this is not a lookup table. It is a [Flags] enum, so one URL routinely
// carries several at once and a switch on the number would match none of them.
test('a combined mask decodes to every flag in it', () => {
  assert.deepEqual(decodeCrawlIssues(4 | 16), ['HTTP 4xx', 'Blocked by robots.txt']);
  assert.deepEqual(decodeCrawlIssues(20), ['HTTP 4xx', 'Blocked by robots.txt'], '20 is the same mask');
  assert.equal(decodeCrawlIssues(511).length, 9, 'every flag at once');
});

test('no issues is an empty list, not a phantom finding', () => {
  assert.deepEqual(decodeCrawlIssues(0), []);
  assert.deepEqual(decodeCrawlIssues(null), []);
  assert.deepEqual(decodeCrawlIssues(undefined), []);
  assert.deepEqual(decodeCrawlIssues('nonsense'), []);
});

test('an unknown bit is ignored rather than breaking the known ones', () => {
  // Bing adding a 512 flag must not stop the 4 being reported.
  assert.deepEqual(decodeCrawlIssues(512 | 4), ['HTTP 4xx']);
});

// ── WCF dates ────────────────────────────────────────────────────────────────────────

test("WCF's epoch-in-a-string is read", () => {
  assert.equal(parseBingDate('/Date(1600000000000)/')?.toISOString(), '2020-09-13T00:00:00.000Z');
});

test('a timezone offset glued on the end does not break it', () => {
  assert.equal(parseBingDate('/Date(1600000000000+0000)/')?.toISOString(), '2020-09-13T00:00:00.000Z');
  assert.ok(parseBingDate('/Date(1600000000000-0700)/'));
});

test('an ISO date is accepted too, since some endpoints return one', () => {
  assert.equal(parseBingDate('2026-09-01T00:00:00Z')?.toISOString(), '2026-09-01T00:00:00.000Z');
});

// Normalised to midnight, or the same day arrives twice under two timestamps and the
// unique key on metric_snapshot lets both in.
test('a time of day is flattened to the day', () => {
  assert.equal(parseBingDate('2026-09-01T17:43:12Z')?.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('anything unparseable is dropped, never an epoch row', () => {
  assert.equal(parseBingDate('not a date'), null);
  assert.equal(parseBingDate(''), null);
  assert.equal(parseBingDate(null), null);
  assert.equal(parseBingDate(12345), null);
});

// ── the sync ─────────────────────────────────────────────────────────────────────────

function stub(payloads: Record<string, unknown[]>) {
  const calls: string[] = [];
  global.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    const method = href.split('/json/')[1]?.split('?')[0] ?? '';
    calls.push(method);
    return new Response(JSON.stringify({ d: payloads[method] ?? [] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

async function runSync(payloads: Record<string, unknown[]>) {
  const original = global.fetch;
  const calls = stub(payloads);
  try {
    const points = await bingWebmaster.sync!(
      JSON.stringify({ apiKey: 'k' }),
      { siteUrl: 'https://usaindiacfo.com' },
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') },
    );
    return { points, calls };
  } finally {
    global.fetch = original;
  }
}

const typesOf = (points: MetricPoint[]) => [...new Set(points.map((p) => p.entityType))].sort();

// The load-bearing test. Search Console writes `site` and `seo_page` for the same dates
// and URLs; metric_snapshot is unique on (source, entityType, entityId, metricKey, date),
// so a differing source lets BOTH rows exist. readSearchTrend selects on entityType alone
// and assigns rather than sums, and writeSeoRows mints a SeoPage per `seo_page` point with
// clicks defaulted to zero — which would wipe real traffic off every URL Bing mentions.
test('Bing never writes into the entity types Search Console owns', async () => {
  const { points } = await runSync({
    GetRankAndTrafficStats: [{ Date: '/Date(1788998400000)/', Clicks: 5, Impressions: 100 }],
    GetCrawlIssues: [{ Url: 'https://usaindiacfo.com/a', Issues: 4, HttpCode: 404, InLinks: 3 }],
  });

  assert.deepEqual(typesOf(points), ['seo_page_bing', 'site_bing']);
  assert.ok(!points.some((p) => p.entityType === 'site'), 'would overwrite the SEO trend chart');
  assert.ok(!points.some((p) => p.entityType === 'seo_page'), 'would blank SeoPage traffic');
});

test('traffic becomes a daily series under its own metric keys', async () => {
  const { points } = await runSync({
    GetRankAndTrafficStats: [{ Date: '/Date(1788998400000)/', Clicks: 5, Impressions: 100 }],
  });
  const keys = points.map((p) => p.metricKey).sort();
  assert.deepEqual(keys, ['bing_clicks', 'bing_impressions']);
  assert.equal(points.find((p) => p.metricKey === 'bing_clicks')?.value, 5);
});

test('a day outside the requested window is dropped', async () => {
  const { points } = await runSync({
    // 2019, far outside the range the sync asked for.
    GetRankAndTrafficStats: [{ Date: '/Date(1560000000000)/', Clicks: 99, Impressions: 999 }],
  });
  assert.equal(points.length, 0, 'a sync must not widen its own range');
});

test('a crawl issue carries its decoded names, not the raw mask', async () => {
  const { points } = await runSync({
    GetCrawlIssues: [{ Url: 'https://usaindiacfo.com/a', Issues: 4 | 16, HttpCode: 404, InLinks: 7 }],
  });
  const [point] = points;
  assert.equal(point.value, 2, 'the value is how many issues, so it can be summed');
  assert.deepEqual(point.entityMeta?.issues, ['HTTP 4xx', 'Blocked by robots.txt']);
  assert.equal(point.entityMeta?.httpCode, 404);
  assert.equal(point.entityMeta?.inLinks, 7);
});

test('a URL Bing reports with no issues is not stored as a finding', async () => {
  const { points } = await runSync({
    GetCrawlIssues: [{ Url: 'https://usaindiacfo.com/fine', Issues: 0 }],
  });
  assert.equal(points.length, 0);
});

test('a row with no URL is skipped rather than keyed on undefined', async () => {
  const { points } = await runSync({ GetCrawlIssues: [{ Issues: 4 }] });
  assert.equal(points.length, 0);
});

test('an empty response is no points, not a throw', async () => {
  const { points } = await runSync({});
  assert.deepEqual(points, []);
});

// ── refusals ─────────────────────────────────────────────────────────────────────────

test('a rejected key says where to get a new one', async () => {
  const original = global.fetch;
  global.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        bingWebmaster.sync!(JSON.stringify({ apiKey: 'k' }), { siteUrl: 'https://a.com' }, {
          from: new Date(),
          to: new Date(),
        }),
      /Settings → API Access/,
    );
  } finally {
    global.fetch = original;
  }
});

// Bing answers some errors with a 200 and a fault body, which would otherwise be read as
// an empty result and reported as a clean sync.
test('a fault body returned with a 200 is still a failure', async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ Message: 'Invalid site' }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        bingWebmaster.sync!(JSON.stringify({ apiKey: 'k' }), { siteUrl: 'https://a.com' }, {
          from: new Date(),
          to: new Date(),
        }),
      /Invalid site/,
    );
  } finally {
    global.fetch = original;
  }
});

// A key that works but cannot see the configured site fails on the first sync otherwise —
// hours later, somewhere nobody is looking.
test('connecting checks the key can actually see the site', async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ d: [{ Url: 'https://someone-else.com' }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        bingWebmaster.connect({
          kind: 'apiKey',
          apiKey: 'k',
          config: { siteUrl: 'https://usaindiacfo.com' },
        }),
      /no access to https:\/\/usaindiacfo\.com/,
    );
  } finally {
    global.fetch = original;
  }
});

// ── registration ─────────────────────────────────────────────────────────────────────

test('the provider is registered, so the Integration Center renders it', () => {
  assert.equal(getProvider('bing_webmaster')?.name, 'Bing Webmaster Tools');
});

test('a trailing slash or a bare domain is normalised the way Bing lists a site', () => {
  const normalise = bingWebmaster.configFields?.find((f) => f.name === 'siteUrl')?.normalise;
  assert.ok(normalise);
  assert.equal(normalise('https://usaindiacfo.com/'), 'https://usaindiacfo.com');
  assert.equal(normalise('usaindiacfo.com'), 'https://usaindiacfo.com');
  assert.throws(() => normalise('not a site'));
});
