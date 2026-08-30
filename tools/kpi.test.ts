import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KPI_SERIES, kpiDelta, kpiIsComparable, type Kpi } from '../lib/kpi.ts';

// The delta drives a green or red pill on every KPI card. Getting the direction wrong
// paints rising spend as a win, so the sign and the null cases are worth pinning down.

const kpi = (over: Partial<Kpi>): Kpi => ({
  key: 'k',
  label: 'K',
  value: 0,
  previous: 0,
  format: 'number',
  higherIsBetter: true,
  ...over,
});

test('a rise is positive and a fall is negative', () => {
  assert.equal(kpiDelta(kpi({ value: 110, previous: 100 })), 10);
  assert.equal(kpiDelta(kpi({ value: 90, previous: 100 })), -10);
});

test('no baseline yields null rather than a fabricated percentage', () => {
  // Zero previous would be a division by zero; "grew infinitely" is not a useful claim.
  assert.equal(kpiDelta(kpi({ value: 50, previous: 0 })), null);
  assert.equal(kpiDelta(kpi({ value: 50, previous: null })), null);
  assert.equal(kpiDelta(kpi({ value: null, previous: 50 })), null);
  assert.equal(kpiDelta(kpi({ value: null, previous: null })), null);
});

test('no change is zero, which is distinct from null', () => {
  assert.equal(kpiDelta(kpi({ value: 100, previous: 100 })), 0);
});

test('higherIsBetter does not affect the delta, only its colour', () => {
  // The sign is arithmetic; the good/bad reading happens in the card. A metric where
  // rising is bad must still report the same +10.
  const up = { value: 110, previous: 100 };
  assert.equal(
    kpiDelta(kpi({ ...up, higherIsBetter: true })),
    kpiDelta(kpi({ ...up, higherIsBetter: false })),
  );
});

test('negative values compare without flipping the sign', () => {
  // A refund can push revenue negative; the delta must not invert.
  assert.equal(kpiDelta(kpi({ value: -50, previous: 100 })), -150);
});

// A change chip is only honest if the data reaches back into the period it compares
// against. GA4 connected on 27 July, so a 30-day dashboard was comparing a full month of
// sessions with the three days that existed in the window before it — and rendering that
// as "+800.9% growth".
const JUL = new Date('2026-07-27T00:00:00Z');
const OLD = new Date('2024-01-01T00:00:00Z');
const PREV_FROM = new Date('2026-07-01T00:00:00Z');

test('a KPI is comparable when its series predates the window', () => {
  assert.equal(kpiIsComparable('leads', PREV_FROM, { leads: OLD }), true);
  assert.equal(kpiIsComparable('visitors', PREV_FROM, { sessions: OLD }), true);
});

test('a KPI is not comparable when its data starts inside the window', () => {
  assert.equal(kpiIsComparable('visitors', PREV_FROM, { sessions: JUL }), false);
  assert.equal(kpiIsComparable('spend', PREV_FROM, { spend: JUL }), false);
});

test('a ratio is only as trustworthy as its thinnest input', () => {
  // CAC is spend over customers. Long customer history does not rescue it when the
  // spend it divides has only just started being recorded.
  assert.equal(kpiIsComparable('cac', PREV_FROM, { spend: JUL, customers: OLD }), false);
  assert.equal(kpiIsComparable('cac', PREV_FROM, { spend: OLD, customers: OLD }), true);
  assert.equal(kpiIsComparable('roas', PREV_FROM, { spend: OLD, revenue: JUL }), false);
});

test('a series with no data at all is not comparable', () => {
  assert.equal(kpiIsComparable('visitors', PREV_FROM, { sessions: null }), false);
  assert.equal(kpiIsComparable('visitors', PREV_FROM, {}), false);
});

test('an unmapped KPI key is left alone rather than silently blanked', () => {
  assert.equal(kpiIsComparable('something-new', PREV_FROM, {}), true);
});

test('every mapped KPI key names at least one series', () => {
  for (const [key, series] of Object.entries(KPI_SERIES)) {
    assert.ok(series.length > 0, `${key} maps to no series`);
  }
});
