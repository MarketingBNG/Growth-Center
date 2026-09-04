import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_THRESHOLD,
  coverageCaveat,
  parseThreshold,
  type AttributionHealth,
} from '../lib/attribution.ts';

// ── parseThreshold ────────────────────────────────────────────────────────────────────
//
// It sits between a text field and a comparison that decides whether a ranking is
// presented as evidence, so every shape a text field can produce is checked.

test('a plain number comes through', () => {
  assert.equal(parseThreshold(70), 70);
});

test('the stored shape comes through', () => {
  assert.equal(parseThreshold({ percent: 55 }), 55);
});

test('nothing at all falls back to the default', () => {
  for (const input of [undefined, null, {}, '', 'seventy', NaN, { percent: 'high' }]) {
    assert.equal(parseThreshold(input), DEFAULT_THRESHOLD, `for ${JSON.stringify(input)}`);
  }
});

test('out of range is clamped rather than rejected', () => {
  assert.equal(parseThreshold(140), 100);
  assert.equal(parseThreshold(-20), 0);
});

test('a fraction is rounded, so the comparison is against a whole percent', () => {
  assert.equal(parseThreshold(70.4), 70);
  assert.equal(parseThreshold(70.6), 71);
});

test('zero is a real setting, not an absent one', () => {
  assert.equal(parseThreshold(0), 0);
});

test('Infinity does not become a threshold nothing can clear', () => {
  assert.equal(parseThreshold(Infinity), DEFAULT_THRESHOLD);
});

// ── coverageCaveat ────────────────────────────────────────────────────────────────────

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function health(over: Partial<AttributionHealth> = {}): AttributionHealth {
  return {
    leads: { percent: 99.6, covered: 27349, total: 27458 },
    deals: { percent: 18.3, covered: 1477, total: 8072 },
    revenue: { percent: 37.5, covered: 2134613, total: 5691513 },
    currency: 'INR',
    threshold: 70,
    sufficient: false,
    ...over,
  };
}

test('below the threshold, the caveat names both amounts', () => {
  const text = coverageCaveat(health(), money);
  assert.ok(text);
  assert.ok(text.includes('₹21,34,613'), text);
  assert.ok(text.includes('₹56,91,513'), text);
  assert.ok(text.includes('38%'), text);
  assert.ok(text.includes('70%'), text);
});

test('above the threshold there is no caveat', () => {
  assert.equal(coverageCaveat(health({ sufficient: true }), money), null);
});

// Null is not false. A period with nothing in it has not failed a standard, and greying
// out a table on that basis reports an empty month as a data-quality problem.
test('nothing to measure is not a failure', () => {
  const empty = health({
    sufficient: null,
    revenue: { percent: null, covered: 0, total: 0 },
  });
  assert.equal(coverageCaveat(empty, money), null);
});

test('the caveat says what it is safe to do with the ranking', () => {
  const text = coverageCaveat(health(), money) ?? '';
  assert.match(text, /not a basis for moving budget/);
});
