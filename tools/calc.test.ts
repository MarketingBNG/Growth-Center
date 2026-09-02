import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairShare, pipelineValue } from '../lib/calc.ts';

test('pipelineValue sums total and probability-weighted value', () => {
  const { total, weighted } = pipelineValue([
    { value: 100000, probability: 50 },
    { value: 40000, probability: 25 },
  ]);
  assert.equal(total, 140000);
  assert.equal(weighted, 60000);
});

// Prisma returns Decimal columns as objects, not numbers. If this coercion regresses,
// every pipeline figure becomes string concatenation instead of arithmetic.
test('pipelineValue coerces Prisma Decimal-like values', () => {
  const decimalish = { toString: () => '25000' };
  const { total } = pipelineValue([{ value: decimalish, probability: 100 }]);
  assert.equal(total, 25000);
});

test('pipelineValue is zero for an empty pipeline', () => {
  assert.deepEqual(pipelineValue([]), { total: 0, weighted: 0 });
});

test('a 0% deal adds to total but not to weighted', () => {
  const { total, weighted } = pipelineValue([{ value: 80000, probability: 0 }]);
  assert.equal(total, 80000);
  assert.equal(weighted, 0);
});

// ── fair lead flow ────────────────────────────────────────────────────────────
// "So that everyone gets a fair lead flow every day" — the Sep 2 review. The first
// version of this compared each person's per-working-day rate against a per-calendar-day
// target, which put all eleven regular owners above target at once.

test('an average cannot have everyone above it', () => {
  // Real shape: a few heavy owners, a long tail of people who took one lead all month.
  const owners = [
    { name: 'a', leads: 228, activeDays: 29 },
    { name: 'b', leads: 156, activeDays: 28 },
    { name: 'c', leads: 86, activeDays: 21 },
    { name: 'd', leads: 12, activeDays: 10 },
    { name: 'e', leads: 1, activeDays: 1 },
  ];
  const total = owners.reduce((n, o) => n + o.leads, 0);
  const { ranked } = fairShare(owners, total, 30);

  assert.ok(ranked.some((r) => r.vsTarget > 0), 'someone must be above the even share');
  assert.ok(ranked.some((r) => r.vsTarget < 0), 'someone must be below it');
});

test('shares sum to the whole, and the ranking is by volume', () => {
  const owners = [
    { name: 'a', leads: 60, activeDays: 10 },
    { name: 'b', leads: 30, activeDays: 10 },
    { name: 'c', leads: 10, activeDays: 5 },
  ];
  const { ranked, evenShare, target } = fairShare(owners, 100, 10);

  assert.equal(ranked.map((r) => r.name).join(''), 'abc');
  assert.equal(ranked.reduce((n, r) => n + r.share, 0).toFixed(4), '100.0000');
  // Three people, so an even share is a third of the leads.
  assert.equal(evenShare.toFixed(4), (100 / 3).toFixed(4));
  // 100 leads / 3 people / 10 days.
  assert.equal(target.toFixed(4), (100 / 3 / 10).toFixed(4));
});

test('vsTarget is measured against an even share, not against the busiest', () => {
  // Four people, one of whom took half. An even share is 25%.
  const owners = [
    { name: 'a', leads: 50, activeDays: 10 },
    { name: 'b', leads: 25, activeDays: 10 },
    { name: 'c', leads: 25, activeDays: 10 },
    { name: 'd', leads: 0, activeDays: 0 },
  ];
  const { ranked, topSkew } = fairShare(owners, 100, 10);
  const by = (n: string) => ranked.find((r) => r.name === n)!;

  assert.equal(by('a').vsTarget.toFixed(0), '100'); // 50% against 25% is double
  assert.equal(by('b').vsTarget.toFixed(0), '0'); // exactly the even share
  assert.equal(by('d').vsTarget.toFixed(0), '-100'); // took none
  assert.equal(topSkew.toFixed(1), '2.0');
});

test('perDay uses the period, so it can be compared with the target', () => {
  // The bug: dividing by the person's own active days made this a different quantity
  // from the target and every regular owner looked over.
  const { ranked, target } = fairShare(
    [{ name: 'a', leads: 60, activeDays: 6 }, { name: 'b', leads: 60, activeDays: 30 }],
    120,
    30,
  );
  // Both took the same number of leads, so both sit exactly on the target — however many
  // days each of them happened to be active.
  for (const r of ranked) {
    assert.equal(r.perDay.toFixed(4), target.toFixed(4));
    assert.equal(r.vsTarget.toFixed(0), '0');
  }
});

test('fairShare survives an empty period rather than dividing by zero', () => {
  const empty = fairShare([], 0, 0);
  assert.deepEqual(empty.ranked, []);
  assert.equal(empty.target, 0);
  assert.equal(empty.evenShare, 0);
  assert.equal(empty.topSkew, 1);
  assert.ok(Number.isFinite(fairShare([{ name: 'a', leads: 0, activeDays: 0 }], 0, 0).ranked[0].share));
});
