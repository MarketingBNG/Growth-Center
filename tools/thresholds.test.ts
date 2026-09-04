import assert from 'node:assert/strict';
import test from 'node:test';

import {
  THRESHOLDS,
  THRESHOLD_KEYS,
  isThresholdKey,
  parseThresholdValue,
} from '../lib/thresholds.ts';

test('every threshold declares a label, unit, default and hint', () => {
  for (const key of THRESHOLD_KEYS) {
    const spec = THRESHOLDS[key];
    assert.ok(spec.label, key);
    assert.ok(spec.unit, key);
    assert.ok(Number.isFinite(spec.default), key);
    assert.ok(spec.hint.length > 20, `${key} hint should say what the number means`);
  }
});

// A threshold's unit is the reason the currency-blind literal this replaced was wrong:
// it was a bare number worth about $10 against a rupee workspace.
test('a percentage threshold is capped at 100 and a count is not', () => {
  assert.equal(parseThresholdValue('attribution.threshold', 140), 100);
  assert.equal(parseThresholdValue('seo.impressionFloor', 500_000), 500_000);
});

test('a stored value comes back whichever shape it was written in', () => {
  // The attribution threshold was written as {percent} before this module existed.
  assert.equal(parseThresholdValue('attribution.threshold', { percent: 55 }), 55);
  assert.equal(parseThresholdValue('attribution.threshold', { value: 55 }), 55);
  assert.equal(parseThresholdValue('attribution.threshold', 55), 55);
});

test('nonsense falls back to the default rather than to zero', () => {
  for (const bad of [undefined, null, {}, '', 'thirty', NaN, Infinity, -5]) {
    assert.equal(
      parseThresholdValue('pipeline.staleDays', bad),
      THRESHOLDS['pipeline.staleDays'].default,
      JSON.stringify(bad),
    );
  }
});

// Zero is a real setting — a floor of zero means "report everything" — and must not be
// mistaken for an absent one.
test('zero is kept', () => {
  assert.equal(parseThresholdValue('tasks.overdueFloor', 0), 0);
});

test('a fraction is rounded, so the comparison is against a whole number', () => {
  assert.equal(parseThresholdValue('leads.slaHours', 47.6), 48);
});

test('isThresholdKey rejects anything not declared', () => {
  assert.equal(isThresholdKey('pipeline.staleDays'), true);
  for (const bad of ['staleDays', 'pipeline.stale', '', null, 7]) {
    assert.equal(isThresholdKey(bad), false, JSON.stringify(bad));
  }
});
