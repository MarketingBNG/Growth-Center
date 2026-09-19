import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldByEntity, rank } from '../lib/analytics/seo.ts';
import { countryKey } from '../lib/integrations/providers/search-console.ts';

// The US/India table on the SEO page.
//
// Everything the reader does with the database is a single findMany; the judgement is in
// these two functions, so they are what is tested.

const rows = (...specs: [country: string, entity: string, key: string, value: number][]) =>
  specs.map(([country, entity, metricKey, value]) => ({
    entityId: countryKey(country, entity),
    metricKey,
    value,
  }));

test('a page carries both markets side by side', () => {
  const folded = foldByEntity(
    rows(
      ['usa', '/services/', 'clicks', 70],
      ['usa', '/services/', 'impressions', 700],
      ['ind', '/services/', 'clicks', 7],
      ['ind', '/services/', 'impressions', 700],
    ),
  );

  const markets = folded.get('/services/');
  assert.ok(markets);
  assert.equal(markets.usa.clicks, 70);
  assert.equal(markets.ind.clicks, 7);
  // The same impressions in both markets and ten times the clicks in one is exactly the
  // finding this table exists to surface, and it is invisible once the two are summed.
  assert.equal(markets.usa.ctr, 10);
  assert.equal(markets.ind.ctr, 1);
});

test('a market with no impressions has no CTR, which is not nought per cent', () => {
  const folded = foldByEntity(rows(['usa', '/a/', 'clicks', 0], ['usa', '/a/', 'impressions', 0]));
  const markets = folded.get('/a/');
  assert.equal(markets?.usa.ctr, null, '0% would say the page was shown and ignored');
  assert.equal(markets?.usa.position, null);
});

test('a page seen in one market only still reports the other as zero, not missing', () => {
  const folded = foldByEntity(rows(['usa', '/only-us/', 'clicks', 5], ['usa', '/only-us/', 'impressions', 50]));
  const markets = folded.get('/only-us/');
  assert.equal(markets?.usa.clicks, 5);
  assert.equal(markets?.ind.clicks, 0, 'the row must render both columns');
  assert.equal(markets?.ind.ctr, null);
});

// Search Console reports every country that has ever seen the site. The sync asks for two,
// but a row left over from an earlier shape of this feature, or a hand-written row, must
// not appear as a third column the table has no header for.
test('a country outside the two tracked markets is ignored', () => {
  const folded = foldByEntity(rows(['gbr', '/a/', 'clicks', 99], ['usa', '/a/', 'clicks', 1]));
  const markets = folded.get('/a/');
  assert.equal(markets?.usa.clicks, 1);
  assert.deepEqual(Object.keys(markets ?? {}).sort(), ['ind', 'usa']);
});

test('a row with no entity is dropped rather than folded under an empty key', () => {
  const folded = foldByEntity([{ entityId: 'usa', metricKey: 'clicks', value: 5 }]);
  assert.equal(folded.size, 0);
});

test('position is kept per market, because it differs per market', () => {
  const folded = foldByEntity(
    rows(['usa', '/a/', 'position', 3.2], ['ind', '/a/', 'position', 41.7]),
  );
  assert.equal(folded.get('/a/')?.usa.position, 3.2);
  assert.equal(folded.get('/a/')?.ind.position, 41.7);
});

test('the busiest rows across both markets come first, and the list is capped', () => {
  const folded = foldByEntity(
    rows(
      ['usa', '/small/', 'clicks', 1],
      ['usa', '/big/', 'clicks', 10],
      ['ind', '/big/', 'clicks', 10],
      ['usa', '/middle/', 'clicks', 15],
    ),
  );

  const ranked = rank(folded, 2);
  assert.deepEqual(
    ranked.map((r) => r.entity),
    ['/big/', '/middle/'],
    '/big/ is 20 across both markets and outranks /middle/ at 15 in one',
  );
  assert.equal(ranked[0].total, 20);
});

test('rows with no clicks are ordered by impressions rather than arbitrarily', () => {
  const folded = foldByEntity(
    rows(
      ['usa', '/quiet/', 'impressions', 10],
      ['usa', '/seen/', 'impressions', 900],
    ),
  );
  assert.deepEqual(
    rank(folded, 5).map((r) => r.entity),
    ['/seen/', '/quiet/'],
  );
});
