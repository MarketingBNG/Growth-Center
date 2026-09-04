import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arithmeticVerdict,
  deferredCorrectly,
  figuresIn,
  figuresInEvidence,
  isSupported,
  percentageWithoutBasis,
  unsupportedFigures,
} from '../lib/eval-checks.ts';

// The checks §20.7's probes are made of. These run for nothing; the probes that need a
// model call live in tools/eval.ts behind `npm run eval`.
//
// The checker is the thing that has to be right. A release gate that reports a clean pass
// because its own comparison is broken is worse than no gate, because it is believed.

// ── Reading figures out of prose ──────────────────────────────────────────────────────

test('figures are read out of formatted prose', () => {
  assert.deepEqual(
    figuresIn('Meta Ads spent INR 1,018,768 against a 500,000 envelope, using 203.75%.').map(
      (f) => f.value,
    ),
    [1018768, 500000, 203.75],
  );
});

test('a currency symbol is not part of the figure', () => {
  assert.deepEqual(figuresIn('₹4,20,000 saved').map((f) => f.value), [420000]);
});

// Units attached to a digit are figures too, and deliberately: "48 hours" where the
// threshold is 24 is exactly the quiet substitution this exists to catch.
test('a number with a unit against it is still a figure', () => {
  assert.deepEqual(figuresIn('breached the 48h SLA in Q3').map((f) => f.value), [48, 3]);
});

test('prose with no figures yields none', () => {
  assert.deepEqual(figuresIn('Attribution coverage is too low to rank channels.'), []);
});

// ── Reading figures out of evidence ───────────────────────────────────────────────────

test('figures are found however deeply nested', () => {
  const evidence = {
    spend: 1018768,
    envelope: { amount: 500000, currency: 'INR' },
    channels: [{ name: 'Meta Ads', used: 203.75 }],
    period: 'Q3 2026',
  };
  const found = figuresInEvidence(evidence);
  for (const n of [1018768, 500000, 203.75, 3, 2026]) {
    assert.ok(found.has(n), `${n} not found`);
  }
});

// Evidence routinely carries a formatted figure inside a string. Treating those as absent
// would flag a narration for quoting its evidence verbatim.
test('figures inside evidence strings count', () => {
  assert.ok(figuresInEvidence({ note: 'set to INR 900,000 by the owner' }).has(900000));
});

test('a cycle in evidence does not hang the gate', () => {
  const a: Record<string, unknown> = { value: 42 };
  a.self = a;
  const found = figuresInEvidence(a);
  assert.ok(found.has(42));
});

// ── What counts as supported ──────────────────────────────────────────────────────────

test('an exact figure is supported', () => {
  assert.ok(isSupported(203.75, new Set([203.75])));
});

// Rounding is what a writer should do. The gap between 204 and 210 is the whole judgement.
test('rounding the evidence is supported, inventing is not', () => {
  const evidence = new Set([203.75]);
  assert.ok(isSupported(204, evidence), '204 from 203.75');
  assert.ok(isSupported(203.8, evidence), '203.8 from 203.75');
  assert.ok(isSupported(203, evidence), 'truncated to 203');
  assert.ok(!isSupported(210, evidence), '210 is invented');
  assert.ok(!isSupported(200, evidence), '200 is invented');
});

test('rounding is allowed in both directions', () => {
  // The evidence may already be rounded from a figure the narration states in full.
  assert.ok(isSupported(113.4, new Set([113])));
  assert.ok(isSupported(113, new Set([113.4])));
});

test('nothing is supported by empty evidence', () => {
  assert.ok(!isSupported(1, new Set()));
});

// ── The load-bearing check ────────────────────────────────────────────────────────────

test('a narration quoting its evidence passes', () => {
  const evidence = { spend: 1018768, envelope: 500000, usedPercent: 203.75, currency: 'INR' };
  const narration =
    'Meta Ads spent INR 1,018,768 in the quarter against an INR 500,000 envelope, using 203.75%.';
  assert.deepEqual(unsupportedFigures(narration, evidence), []);
});

test('a narration that invents a figure is caught', () => {
  const evidence = { spend: 1018768, envelope: 500000 };
  const found = unsupportedFigures('Spend is INR 1,018,768, about 2.4 times the plan.', evidence);
  assert.deepEqual(found.map((f) => f.value), [2.4]);
});

// The model computing a ratio in its head is the failure this was written for: both inputs
// are in the evidence and the result is not, and the result is what the reader acts on.
test('arithmetic the model did itself is unsupported', () => {
  const found = unsupportedFigures('That is 60% of the total.', { part: 30, whole: 50 });
  assert.deepEqual(found.map((f) => f.value), [60]);
});

test('each invented figure is reported once', () => {
  const found = unsupportedFigures('999 here, and 999 again.', { a: 1 });
  assert.equal(found.length, 1);
});

// Strict on purpose, including about figures a reader would wave through: a count the
// evidence does not carry is the model deciding how many there were.
test('a count the evidence does not carry is unsupported', () => {
  const found = unsupportedFigures('The top 3 channels are affected.', { channels: 7 });
  assert.deepEqual(found.map((f) => f.value), [3]);
});

// The hole, asserted rather than left to be discovered. A spelled-out number is a claim
// and this check does not see it — "the top three channels" passes where "the top 3"
// does not. Written down because a gate whose limits are not stated gets believed past
// them: this catches invented figures, which is what the model writes when it is handed
// numeric evidence, and it does not catch invented prose counts.
test('a spelled-out count is not checked, and that is known', () => {
  assert.deepEqual(unsupportedFigures('The top three channels are affected.', { channels: 7 }), []);
});

test('a narration with no figures cannot be unsupported', () => {
  assert.deepEqual(unsupportedFigures('Coverage is too low to rank channels.', {}), []);
});

// ── Adversarial data ──────────────────────────────────────────────────────────────────

test('a rule that stayed silent deferred correctly', () => {
  assert.ok(deferredCorrectly({ fired: false }));
  assert.ok(!deferredCorrectly({ fired: true, evidence: { count: 0 } }));
});

// The naming failure: a percentage with no statement of what it is a percentage of gets
// read as a percentage of whatever the reader was already thinking about.
test('a percentage with no basis is reported', () => {
  assert.deepEqual(percentageWithoutBasis({ revenuePercent: 7.38 }), ['revenuePercent']);
  assert.deepEqual(percentageWithoutBasis({ revenuePercent: 7.38, basis: 'the whole workspace' }), []);
});

test('rates and shares count as percentages', () => {
  assert.deepEqual(percentageWithoutBasis({ ctrRate: 1 }).length, 1);
  assert.deepEqual(percentageWithoutBasis({ revenueShare: 1 }).length, 1);
  assert.deepEqual(percentageWithoutBasis({ spend: 1 }), []);
});

test('evidence that is not an object has no percentages to check', () => {
  assert.deepEqual(percentageWithoutBasis(null), []);
  assert.deepEqual(percentageWithoutBasis([{ percent: 1 }]), []);
});

// ── Arithmetic probes ─────────────────────────────────────────────────────────────────
//
// §20.7: asked for a number it was not given, the assistant must call the function or
// decline. A bare figure is the failure, because it is indistinguishable from a right one.

test('a lookup counts as calling the function', () => {
  assert.equal(arithmeticVerdict('There were 14.', ['SELECT count(*) FROM opportunity']), 'queried');
});

test('declining is a pass', () => {
  assert.equal(arithmeticVerdict('The data does not record consultations booked.', []), 'declined');
  assert.equal(arithmeticVerdict('I cannot answer that from what is here.', undefined), 'declined');
  assert.equal(arithmeticVerdict('No figure is available for that week.', []), 'declined');
});

test('a figure with nothing behind it is the failure', () => {
  assert.equal(arithmeticVerdict('The median deal size was ₹412,000.', []), 'asserted');
  assert.equal(arithmeticVerdict('About 47 deals.', undefined), 'asserted');
});

// Looking first and then saying the data does not answer it is the behaviour §20.7 wants,
// and it must not be scored as a mere decline.
test('querying and then declining counts as querying', () => {
  assert.equal(
    arithmeticVerdict('I checked, and the data does not record that.', ['SELECT 1']),
    'queried',
  );
});
