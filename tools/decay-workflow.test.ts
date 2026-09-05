import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECAY_FLOOR, DECAY_GRACE_DAYS, DECAY_HALF_LIFE_DAYS, decay, decayFactor, explainDecay } from '../lib/decay.ts';
import { canMoveTo } from '../lib/content.ts';
import { CONTENT_PIPELINE, CONTENT_REVIEW_STATUS, CONTENT_STATUSES } from '../lib/enums.ts';
import { THRESHOLDS } from '../lib/thresholds.ts';

// ── §9.5 probability decay ───────────────────────────────────────────────────────────

// "Weighted pipeline should fall when a deal goes quiet. Today it does not move at all."
// Against the live database this took the weighted figure from ₹9.5m to ₹4.1m, because
// 810 of 967 open deals have gone quiet.
test('a deal worked recently keeps its full stage probability', () => {
  assert.equal(decayFactor(0), 1);
  assert.equal(decayFactor(DECAY_GRACE_DAYS), 1, 'the grace period is inclusive');
  assert.ok(decayFactor(DECAY_GRACE_DAYS + 1) < 1);
});

test('odds halve after a half-life of silence', () => {
  const factor = decayFactor(DECAY_GRACE_DAYS + DECAY_HALF_LIFE_DAYS);
  assert.ok(Math.abs(factor - 0.5) < 0.001);
});

// Not zero. A deal at zero is lost, and this rule has no authority to say so — that needs
// a person. Decaying to nothing would let a silent deal disappear from the forecast
// without anybody deciding it was dead.
test('a deal decays towards a floor rather than to nothing', () => {
  assert.equal(decayFactor(100_000), DECAY_FLOOR);
  assert.ok(DECAY_FLOOR > 0);
});

// A linear decline has a cliff at whatever day it reaches zero, and a discontinuity in a
// forecast is something people notice and stop believing.
test('the curve is continuous, with no day where value falls off a cliff', () => {
  let previous = 1;
  for (let day = 0; day < 400; day++) {
    const factor = decayFactor(day);
    assert.ok(factor <= previous + 1e-9, `factor rose at day ${day}`);
    assert.ok(previous - factor < 0.02, `a cliff at day ${day}`);
    previous = factor;
  }
});

// A deal opened four months ago with nothing ever logged against it is the clearest case
// this exists for, and measuring from a null would have exempted it.
test('a deal with no activity at all decays from when it was opened', () => {
  const now = new Date('2026-09-05');
  const d = decay({ probability: 40, lastActivityAt: null, createdAt: new Date('2026-05-01') }, now);
  assert.ok(d.daysIdle > 120);
  assert.ok(d.probability < 40);
  assert.equal(d.stageProbability, 40, 'the stage figure is kept, so the page can show both');
});

test('an activity is what stops the clock, not the deal being created', () => {
  const now = new Date('2026-09-05');
  const d = decay(
    { probability: 40, lastActivityAt: new Date('2026-09-01'), createdAt: new Date('2024-01-01') },
    now,
  );
  assert.equal(d.probability, 40);
});

// The rule is published rather than hidden behind the number: a forecast that falls for
// reasons nobody can state is one people work around.
test('a decayed deal can explain itself in one sentence', () => {
  const quiet = decay({ probability: 40, lastActivityAt: null, createdAt: new Date('2026-01-01') }, new Date('2026-09-05'));
  const text = explainDecay(quiet);
  assert.ok(text);
  assert.match(text, /Quiet for \d+ days/);
  assert.match(text, /halve every 90 days/);
  // Nothing to explain when nothing happened.
  assert.equal(explainDecay(decay({ probability: 40, lastActivityAt: new Date('2026-09-04'), createdAt: new Date('2026-01-01') }, new Date('2026-09-05'))), null);
});

// One number, not two: a deal flagged stale while still weighing full value, or losing
// value with nothing saying why, are both worse than either alone.
test('the grace period matches the stale-deal threshold', () => {
  assert.equal(DECAY_GRACE_DAYS, THRESHOLDS['pipeline.staleDays'].default);
});

// ── §15.3 the content workflow ───────────────────────────────────────────────────────

test('§15.3’s nine statuses are in the manual’s order', () => {
  assert.deepEqual(
    [...CONTENT_PIPELINE],
    ['idea', 'brief', 'draft', 'technical_check', 'proofread', 'partner_approval', 'scheduled', 'published', 'repurposed'],
  );
  // The technical check and the proofread are two recorded steps rather than one habit,
  // which is the manual's actual complaint about the six-value enum.
  assert.ok(CONTENT_PIPELINE.includes('technical_check'));
  assert.ok(CONTENT_PIPELINE.includes('proofread'));
});

// "No item can skip a status."
test('a piece cannot skip a step forward', () => {
  assert.ok(canMoveTo('idea', 'brief'));
  assert.equal(canMoveTo('idea', 'draft'), false);
  assert.equal(canMoveTo('draft', 'published'), false);
  assert.equal(canMoveTo('technical_check', 'partner_approval'), false, 'the proofread cannot be skipped');
  assert.ok(canMoveTo('partner_approval', 'scheduled'));
});

// Going back is what happens every time a draft turns out to need more work. A workflow
// that only moves forward is one people route around by editing the database.
test('a piece can go back any distance', () => {
  assert.ok(canMoveTo('scheduled', 'draft'));
  assert.ok(canMoveTo('published', 'idea'));
  assert.ok(canMoveTo('draft', 'draft'));
});

// Abandoning an item is not a stage of production. A workflow with no exit forces people
// to publish things to get them off the board.
test('the archive is reachable from anywhere and does not strand a piece', () => {
  for (const status of CONTENT_STATUSES) {
    assert.ok(canMoveTo(status, 'archived'), `${status} cannot be archived`);
    assert.ok(canMoveTo('archived', status), `${status} cannot be restored`);
  }
});

// The approval gate, the SLA clock and the return path all key on one named stage, so a
// change to the workflow moves one constant rather than three literals.
test('the stage that waits for a signature is named once', () => {
  assert.equal(CONTENT_REVIEW_STATUS, 'partner_approval');
  assert.ok(CONTENT_PIPELINE.includes(CONTENT_REVIEW_STATUS));
  // It comes before publishing, or the gate would be unreachable.
  assert.ok(CONTENT_PIPELINE.indexOf(CONTENT_REVIEW_STATUS) < CONTENT_PIPELINE.indexOf('published'));
});
