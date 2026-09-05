import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, readCursor, readField, readIssues, readLab, pagespeed } from '../lib/integrations/providers/pagespeed.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// Shaped from a real response for https://usaindiacfo.com/, trimmed to the fields read.
// Kept as a fixture rather than a live call: one real call takes up to a minute.

const KEY = 'test-key';

function response(overrides: Record<string, unknown> = {}) {
  return {
    loadingExperience: {
      origin_fallback: false,
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2998, category: 'AVERAGE' },
        INTERACTION_TO_NEXT_PAINT: { percentile: 144, category: 'FAST' },
        // CrUX reports CLS in hundredths: this is a real 0.05.
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 2390, category: 'AVERAGE' },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 1765, category: 'AVERAGE' },
      },
    },
    lighthouseResult: {
      categories: { performance: { score: 0.76 } },
      audits: {
        'largest-contentful-paint': { score: 0.94, numericValue: 2273.59, title: 'LCP', displayValue: '2.3 s' },
        'cumulative-layout-shift': { score: 0.99, numericValue: 0.0506, title: 'CLS', displayValue: '0.051' },
        'total-blocking-time': { score: 0.57, numericValue: 513.5, title: 'TBT', displayValue: '510 ms' },
        'speed-index': { score: 0.34, numericValue: 6822.86, title: 'Speed Index', displayValue: '6.8 s' },
      },
    },
    ...overrides,
  };
}

test('the request asks for performance only, and category is repeated not overwritten', () => {
  const url = buildUrl('https://example.com/', 'mobile', KEY);
  assert.match(url, /[?&]category=PERFORMANCE/);
  assert.match(url, /[?&]strategy=mobile/);
  assert.match(url, /[?&]key=test-key/);
  assert.match(url, /url=https%3A%2F%2Fexample\.com%2F/);
});

// The bug this guards against put a page fifty times worse on record than it is.
//
// CrUX reports CLS as an integer in hundredths, so a real 0.05 arrives as 5. Every other
// field metric is already in milliseconds and must pass through untouched. Storing the raw
// 5 would have shown a page that is comfortably inside the 0.1 "good" threshold as scoring
// 5.0 — and the insight rules read these numbers.
test('field CLS is converted out of hundredths and nothing else is', () => {
  const { metrics } = readField(response());

  assert.equal(metrics.cls, 0.05, 'CLS must be converted from CrUX hundredths');
  assert.equal(metrics.lcp, 2998, 'LCP is already in milliseconds');
  assert.equal(metrics.inp, 144);
  assert.equal(metrics.ttfb, 1765);
});

// The trap that changed the design.
//
// Google sets origin_fallback when it has no per-URL sample and is handing back the
// origin's numbers instead. Measured against this site, only the homepage has per-URL
// field data. Storing the fallback per page would have written the *same five numbers*
// onto 250 pages and presented each as a measurement of that page.
test('origin fallback is reported so it is never stored as the page own figure', () => {
  const perUrl = readField(response());
  assert.equal(perUrl.originFallback, false, 'this page has its own CrUX sample');

  const fallback = readField(
    response({ loadingExperience: { origin_fallback: true, metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2127 } } } }),
  );
  assert.equal(fallback.originFallback, true);
});

test('a response with no field data at all is treated as fallback, not as zeroes', () => {
  const { metrics, originFallback } = readField(response({ loadingExperience: undefined }));

  assert.deepEqual(metrics, {}, 'absent field data must not become a metric worth 0');
  assert.equal(originFallback, true, 'unknown provenance is never treated as per-URL');
});

test('the lab score is stored 0-100, the way it is displayed and spoken about', () => {
  const { score, metrics } = readLab(response());

  assert.equal(score, 76);
  assert.equal(metrics.lcp, 2273.59);
  assert.equal(metrics.tbt, 513.5);
  // Lab CLS is already a real unit value and must not be divided the way the field one is.
  assert.equal(metrics.cls, 0.0506);
});

test('a missing performance category yields null, not a zero score', () => {
  const { score } = readLab(response({ lighthouseResult: { audits: {} } }));
  assert.equal(score, null, 'a score of 0 means "measured, terrible" and must not be invented');
});

test('only failing audits become issues, and Lighthouse own scoring sets severity', () => {
  const issues = readIssues(
    response({
      lighthouseResult: {
        categories: { performance: { score: 0.5 } },
        audits: {
          passing: { score: 1, title: 'Passing audit' },
          nearlyPassing: { score: 0.9, title: 'Just inside the pass mark' },
          informative: { score: null, title: 'Diagnostic with nothing to fix' },
          medium: { score: 0.7, title: 'Medium finding', displayValue: '0.4 s' },
          high: { score: 0.2, title: 'High finding', details: { overallSavingsMs: 900 } },
        },
      },
    }),
  );

  assert.deepEqual(
    issues.map((i) => i.code),
    ['high', 'medium'],
    'passing and informative audits are not findings, and the biggest saving leads',
  );
  assert.equal(issues[0].severity, 'high');
  assert.equal(issues[1].severity, 'medium');
  assert.equal(issues[1].message, 'Medium finding — 0.4 s', 'the measured value belongs in the message');
});

// "Measured, nothing wrong" and "never measured" are different states, and the SEO page
// has to be able to tell them apart. An empty array says the first; no row says the second.
test('a clean page produces an empty list rather than no list', () => {
  const issues = readIssues(
    response({ lighthouseResult: { categories: { performance: { score: 1 } }, audits: { ok: { score: 1, title: 'Fine' } } } }),
  );
  assert.deepEqual(issues, []);
});

test('the findings list is capped so it stays a priority order rather than a dump', () => {
  const audits: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    audits[`audit${i}`] = { score: 0.1, title: `Finding ${i}`, details: { overallSavingsMs: i } };
  }
  const issues = readIssues(response({ lighthouseResult: { audits } }));

  assert.equal(issues.length, 10);
  assert.equal(issues[0].code, 'audit29', 'the largest saving comes first');
});

test('a cursor survives a round trip and a damaged one is refused rather than trusted', () => {
  const good = readCursor({ urls: ['https://a.test/', 'https://b.test/'], index: 1 });
  assert.deepEqual(good, { urls: ['https://a.test/', 'https://b.test/'], index: 1 });

  assert.equal(readCursor(null), null);
  assert.equal(readCursor({ index: 3 }), null, 'no url list means there is nothing to resume');
  assert.equal(readCursor({ urls: [] }), null, 'an empty list is a fresh pass, not a finished one');

  // A negative or non-numeric index would silently re-measure or skip pages.
  assert.equal(readCursor({ urls: ['https://a.test/'], index: -5 })?.index, 0);
  assert.equal(readCursor({ urls: ['https://a.test/'], index: 'x' })?.index, 0);
});

// The nightly cron runs every connected provider inside one 300s function and lets each
// use the full 230s budget. PageSpeed takes 17-51 seconds per call — measured runs took
// 237s and 317s — so leaving it in that sequence would have spent the whole nightly budget
// on this one provider and silently stopped everything queued behind it from syncing.
//
// Asserted rather than left to a comment because the flag is invisible at the call site:
// nothing about writing a provider suggests it must opt out of the run it is registered
// into, and the failure is silent.
test('PageSpeed stays out of the nightly sync and keeps its own schedule', () => {
  assert.equal(pagespeed.ownSchedule, true);
  assert.equal(getProvider('pagespeed')?.id, 'pagespeed', 'and is still registered, so the card renders');
});

test('a page limit is normalised rather than trusted', () => {
  const field = pagespeed.configFields?.find((f) => f.name === 'pageLimit');
  const normalise = field?.normalise;
  assert.ok(normalise, 'the limit bounds how long a run takes and cannot be free text');

  assert.equal(normalise('10'), '10');
  assert.equal(normalise(''), '25', 'blank means the default, not zero pages');
  assert.equal(normalise('4.7'), '4', 'a fraction of a page is not a page');
  // Unbounded, this is a request for hours of API time on pages with no traffic.
  assert.equal(normalise('9000'), '250');
  assert.throws(() => normalise('0'));
  assert.throws(() => normalise('nonsense'));
});
