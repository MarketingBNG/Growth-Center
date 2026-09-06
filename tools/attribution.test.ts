import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_THRESHOLD,
  SUFFICIENCY_WINDOW_DAYS,
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

// A percentage above 100 is clamped; a negative one is not. Both mean the person typing
// meant something else, but 140 has an obvious intent and -20 does not — and a rule
// comparing against a silently corrected 0 would fire on nothing forever.
test('over 100 is clamped, and a negative falls back to the default', () => {
  assert.equal(parseThreshold(140), 100);
  assert.equal(parseThreshold(-20), DEFAULT_THRESHOLD);
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

// ── D11: one window behind the word "sufficient" ─────────────────────────────────────
//
// The refusal panel reported 10.1% against a 70% threshold while the coverage insight on
// the same screen reported 7.27%. Both read `attributionHealth`, so the arithmetic was
// never in dispute — each picked its own period. These lock the fix in the two places
// that drifted, because the failure is a product one: a partner reads two numbers for one
// idea and stops believing either.

test('the sufficiency window is a definition, not a caller’s choice', () => {
  const source = readFileSync('lib/attribution.ts', 'utf8');
  assert.equal(SUFFICIENCY_WINDOW_DAYS, 365);
  assert.match(source, /rangeFor\(SUFFICIENCY_WINDOW_DAYS, now\)/);
});

test('§21.4’s refusal asks the shared function, and picks no window of its own', () => {
  const source = readFileSync('lib/review-card.ts', 'utf8');
  assert.match(source, /await attributionSufficiency\(now\)/);
  assert.doesNotMatch(source, /rangeFor\(/);
});

test('the coverage rule asks the same function, and states the window it got', () => {
  const source = readFileSync('lib/insight-rules.ts', 'utf8');
  assert.match(source, /await attributionSufficiency\(ctx\.now\)/);
  // Not ctx.from/ctx.to: that was the drift.
  assert.doesNotMatch(source, /attributionSufficiency\(ctx\.from/);
  assert.match(source, /measuredOverDays: health\.windowDays/);
});

// D6. "Right diagnosis, wrong field" — Lead_Source belongs to the lead, and nobody is
// going to set it by hand on 967 open deals at close.
test('the coverage rule proposes inheritance, not a field nobody will type', () => {
  const source = readFileSync('lib/insight-rules.ts', 'utf8');
  assert.doesNotMatch(source, /Set Lead_Source on the deal/);
  assert.match(source, /inherit Channel and Campaign_ID/);
});
