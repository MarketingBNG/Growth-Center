import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_DAYS, detectDecay, type PageWindow } from '../lib/analytics/page-decay.ts';

// The page decay detector, on fixtures.
//
// Two things make this worth testing carefully rather than eyeballing. The comparison is
// between two 28-day windows that must not overlap, and the floors exist to keep the
// output readable — a detector that reports forty pages that lost one click each is a
// detector nobody opens a second time.

const LIMITS = { clicksDrop: 20, positionFloor: 10, impressionFloor: 100 };

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const win = (
  date: string,
  clicks: number,
  impressions = 1000,
  position: number | null = 5,
): PageWindow => ({ date: day(date), clicks, impressions, position });

const page = (url: string, ...windows: PageWindow[]) => ({ url, windows });

test('a page that lost more than the threshold is a finding', () => {
  const [found] = detectDecay(
    [page('/a/', win('2026-08-01', 100), win('2026-09-01', 50))],
    LIMITS,
  );
  assert.equal(found.url, '/a/');
  assert.equal(found.reason, 'clicks');
  assert.equal(found.clicksLost, 50);
  assert.equal(found.dropPercent, 50);
});

test('a fall just under the threshold is left alone', () => {
  // 20% exactly, and the rule is "more than", so this is not decay.
  assert.deepEqual(detectDecay([page('/a/', win('2026-08-01', 100), win('2026-09-01', 80))], LIMITS), []);
});

test('a page that grew is never a finding', () => {
  assert.deepEqual(detectDecay([page('/a/', win('2026-08-01', 50), win('2026-09-01', 500))], LIMITS), []);
});

// The load-bearing one. Each stored row already covers 28 days, so two rows a week apart
// share three weeks of the same traffic and the "fall" between them is largely the same
// days counted twice.
test('the comparison window never overlaps the current one', () => {
  const windows = [
    win('2026-07-01', 100), // 28+ days before — the legitimate comparison
    win('2026-08-25', 95), // a week before: overlapping, must not be chosen
    win('2026-09-01', 60),
  ];

  const [found] = detectDecay([page('/a/', ...windows)], LIMITS);
  assert.equal(
    found.from.toISOString().slice(0, 10),
    '2026-07-01',
    'compared against the overlapping window instead of the separate one',
  );
  assert.equal(found.clicksBefore, 100);
});

test('the newest window at least 28 days back is chosen, not the oldest there is', () => {
  const [found] = detectDecay(
    [
      page(
        '/a/',
        win('2026-01-01', 900),
        win('2026-07-20', 100),
        win('2026-09-01', 40),
      ),
    ],
    LIMITS,
  );
  assert.equal(found.from.toISOString().slice(0, 10), '2026-07-20');
  assert.equal(found.clicksBefore, 100, 'January is history, not the previous period');
});

test('a page with nothing old enough to compare is unjudged, not healthy', () => {
  assert.deepEqual(
    detectDecay([page('/a/', win('2026-08-25', 100), win('2026-09-01', 1))], LIMITS),
    [],
    'a week apart is not a period comparison',
  );
});

test('a single window is not a comparison', () => {
  assert.deepEqual(detectDecay([page('/a/', win('2026-09-01', 5))], LIMITS), []);
});

// ── the floors ───────────────────────────────────────────────────────────────────────

test('a page too small to measure is not judged', () => {
  const tiny = detectDecay(
    [page('/a/', win('2026-08-01', 2, 20), win('2026-09-01', 1, 15))],
    LIMITS,
  );
  assert.deepEqual(tiny, [], 'two clicks becoming one is a 50% fall and means nothing');
});

test('a page that collapsed from real traffic to nothing is still judged', () => {
  const [found] = detectDecay(
    [page('/a/', win('2026-08-01', 300, 9000), win('2026-09-01', 0, 4))],
    LIMITS,
  );
  assert.ok(found, 'the floor is met if EITHER window clears it, or a collapse escapes notice');
  assert.equal(found.dropPercent, 100);
});

// ── position ─────────────────────────────────────────────────────────────────────────

test('falling off the first page is a finding on its own', () => {
  // Clicks barely moved: this is exactly the case the clicks test cannot catch yet.
  const [found] = detectDecay(
    [page('/a/', win('2026-08-01', 100, 5000, 8), win('2026-09-01', 98, 5000, 13))],
    LIMITS,
  );
  assert.equal(found.reason, 'position');
  assert.equal(found.positionBefore, 8);
  assert.equal(found.positionNow, 13);
});

test('a page that was already off the first page has not just fallen off it', () => {
  assert.deepEqual(
    detectDecay([page('/a/', win('2026-08-01', 100, 5000, 14), win('2026-09-01', 99, 5000, 19))], LIMITS),
    [],
    'it was never inside the floor, so there is no crossing to report',
  );
});

test('both tests tripping is reported as both', () => {
  const [found] = detectDecay(
    [page('/a/', win('2026-08-01', 100, 5000, 4), win('2026-09-01', 20, 5000, 22))],
    LIMITS,
  );
  assert.equal(found.reason, 'both');
});

test('a missing position cannot trip the position test', () => {
  assert.deepEqual(
    detectDecay(
      [page('/a/', win('2026-08-01', 100, 5000, 5), win('2026-09-01', 100, 5000, null))],
      LIMITS,
    ),
    [],
  );
});

// ── ordering ─────────────────────────────────────────────────────────────────────────

test('ordered by clicks lost, not by the steepest percentage', () => {
  const found = detectDecay(
    [
      page('/tiny/', win('2026-08-01', 8, 4000), win('2026-09-01', 1, 4000)), // -88%, 7 clicks
      page('/big/', win('2026-08-01', 4000, 90_000), win('2026-09-01', 2800, 90_000)), // -30%, 1200
    ],
    LIMITS,
  );
  assert.deepEqual(
    found.map((f) => f.url),
    ['/big/', '/tiny/'],
    'a page down 88% of eight clicks is a rounding error beside one down 30% of four thousand',
  );
});

test('the threshold comes from the caller, so config moves it', () => {
  const pages = [page('/a/', win('2026-08-01', 100), win('2026-09-01', 70))];
  assert.equal(detectDecay(pages, LIMITS).length, 1, '30% trips the default 20');
  assert.equal(
    detectDecay(pages, { ...LIMITS, clicksDrop: 50 }).length,
    0,
    'nothing in this module may hard-code the threshold',
  );
});

test('the window length is stated rather than assumed by callers', () => {
  assert.equal(WINDOW_DAYS, 28);
});
