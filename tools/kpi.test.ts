import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kpiDelta, type Kpi } from '../lib/kpi.ts';

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
