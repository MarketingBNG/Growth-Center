import assert from 'node:assert/strict';
import test from 'node:test';

import { distribute } from '../lib/speed-to-lead.ts';

// Appendix C: "distribution of first-touch times, including untouched". The untouched are
// the half the definition most wants, and the half the application used to drop.

const band = (d: ReturnType<typeof distribute>, key: string) =>
  d.bands.find((b) => b.key === key)!;

test('a response lands in the band it finished inside', () => {
  const d = distribute([0.5, 2, 10, 30, 100, 400], 0, 0, 48);
  assert.equal(band(d, 'under1h').leads, 1);
  assert.equal(band(d, 'under4h').leads, 1);
  assert.equal(band(d, 'under24h').leads, 1);
  assert.equal(band(d, 'under48h').leads, 1);
  assert.equal(band(d, 'under168h').leads, 1);
  assert.equal(band(d, 'over168h').leads, 1);
});

// The band that claims a lead must be one the lead genuinely finished inside, so the
// bounds are exclusive at the top.
test('a response exactly on a boundary falls to the slower band', () => {
  const d = distribute([1, 4, 24], 0, 0, 48);
  assert.equal(band(d, 'under1h').leads, 0);
  assert.equal(band(d, 'under4h').leads, 1);
  assert.equal(band(d, 'under24h').leads, 1);
  assert.equal(band(d, 'under48h').leads, 1);
});

test('every touched lead lands in exactly one band', () => {
  const hours = [0, 0.9, 1, 3.9, 4, 23, 47, 167, 168, 5000];
  const d = distribute(hours, 0, 0, 48);
  assert.equal(
    d.bands.reduce((n, b) => n + b.leads, 0),
    hours.length,
  );
});

// ── The untouched ─────────────────────────────────────────────────────────────────────

// Counting them as zero says they were answered instantly; counting them as the lead's own
// age says somebody answered at the moment we looked. Both are inventions.
test('the untouched never enter the median', () => {
  const withNone = distribute([2, 4, 6], 0, 0, 48);
  const withMany = distribute([2, 4, 6], 500, 0, 48);
  assert.equal(withNone.medianHours, 4);
  assert.equal(withMany.medianHours, 4);
});

test('the untouched never enter a response band', () => {
  const d = distribute([2], 99, 0, 48);
  assert.equal(
    d.bands.reduce((n, b) => n + b.leads, 0),
    1,
  );
  assert.equal(d.untouched, 99);
});

// The denominator is every lead, or the bands would sum to 100% while most of the period's
// leads went unanswered — which is exactly the reassurance this metric exists to withhold.
test('percentages are shares of every lead, not of the answered ones', () => {
  const d = distribute([1, 1], 6, 2, 48);
  assert.equal(d.total, 10);
  assert.equal(band(d, 'under4h').percent, 20);
  assert.equal(d.untouchedPercent, 60);
});

// A lead that arrived an hour ago and has not been contacted is not neglect, it is
// Tuesday. Folding it in would make the figure a measure of how recently the report ran.
test('too recent to judge is counted apart from untouched', () => {
  const d = distribute([], 3, 7, 48);
  assert.equal(d.untouched, 3);
  assert.equal(d.tooRecent, 7);
  assert.equal(d.untouchedPercent, 30);
});

test('the SLA it was measured against is reported with the figures', () => {
  assert.equal(distribute([], 0, 0, 24).slaHours, 24);
});

// ── The median ────────────────────────────────────────────────────────────────────────

test('an even count averages the middle pair', () => {
  assert.equal(distribute([1, 2, 3, 4], 0, 0, 48).medianHours, 2.5);
});

test('an odd count takes the middle value', () => {
  assert.equal(distribute([5, 1, 3], 0, 0, 48).medianHours, 3);
});

// Null, not zero. Zero would read as "answered instantly" on a period nobody worked.
test('nothing touched gives no median rather than a zero', () => {
  const d = distribute([], 40, 0, 48);
  assert.equal(d.medianHours, null);
  assert.equal(d.touched, 0);
});

test('an empty period reports zeroes without dividing by zero', () => {
  const d = distribute([], 0, 0, 48);
  assert.equal(d.total, 0);
  assert.equal(d.untouchedPercent, 0);
  assert.ok(d.bands.every((b) => b.percent === 0));
});

// One outlier dragging the mean past every individual response is why this is a median.
test('one very slow response does not move the median', () => {
  assert.equal(distribute([1, 2, 3, 4, 10_000], 0, 0, 48).medianHours, 3);
});
