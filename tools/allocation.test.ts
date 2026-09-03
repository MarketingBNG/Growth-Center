import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNASSIGNED, planMoves, type Holding } from '../lib/allocation.ts';

// The planner is the whole feature: everything else is a Zoho write and a confirm button.
// These cover the properties a person losing leads is entitled to rely on — nobody drops
// below fair share, nobody is asked to give up a lead they are not over the line on, and
// the same data always produces the same plan.

const hold = (email: string | null, n: number, prefix = email ?? 'x'): Holding => ({
  email,
  leadIds: Array.from({ length: n }, (_, i) => `${prefix}-${i}`),
});

test('levels three people onto the same count', () => {
  const plan = planMoves([hold('a', 30), hold('b', 0), hold('c', 0)], { tolerance: 0 });

  assert.equal(plan.target, 10);
  assert.equal(plan.moves.length, 20);
  assert.deepEqual(plan.after, { a: 10, b: 10, c: 10 });
});

test('never takes a donor below the target', () => {
  // The bug this guards: draining the biggest holder to fill everyone else, which turns
  // one overloaded person into one empty one.
  const plan = planMoves([hold('a', 100), hold('b', 1), hold('c', 1)], { tolerance: 0 });

  assert.equal(plan.target, 34);
  assert.equal(plan.after.a, 34);
  assert.ok(Object.values(plan.after).every((n) => n >= plan.target));
});

test('leaves someone alone when they are inside the tolerance', () => {
  // 11 against a fair share of 10 is not worth a Zoho write and an activity row on the
  // lead. At a 10% tolerance the ceiling is exactly 11, and the comparison is strict.
  const plan = planMoves([hold('a', 11), hold('b', 9), hold('c', 10)], { tolerance: 0.1 });

  assert.equal(plan.moves.length, 0);
  assert.equal(plan.deferred, 1);
});

test('a tolerance breach moves down to the target, not to the ceiling', () => {
  // Stopping at the ceiling leaves the donor over it again on the next run, which is how
  // a nightly job turns into an endless trickle of reassignments.
  const plan = planMoves([hold('a', 20), hold('b', 0)], { tolerance: 0.1 });

  assert.equal(plan.target, 10);
  assert.equal(plan.after.a, 10);
  assert.equal(plan.after.b, 10);
});

test('hands out unassigned leads before touching anybody else', () => {
  // An unowned lead costs nobody anything, so it must be spent first. Taking from a
  // person while unassigned leads sit there is strictly worse for the same outcome.
  const plan = planMoves([hold('a', 12), hold('b', 0), hold(null, 4, 'free')], { tolerance: 0 });

  assert.equal(plan.target, 8);
  const fromPool = plan.moves.filter((m) => m.from === null);
  assert.equal(fromPool.length, 4);
  // The pool is exhausted before the first move off a person.
  assert.deepEqual(
    plan.moves.slice(0, 4).map((m) => m.from),
    [null, null, null, null],
  );
  assert.equal(plan.after[UNASSIGNED], 0);
});

test('the unassigned pool never receives', () => {
  const plan = planMoves([hold('a', 10), hold('b', 10), hold(null, 0, 'free')], { tolerance: 0 });

  assert.equal(plan.moves.length, 0);
  assert.equal(plan.after[UNASSIGNED], 0);
});

test('gives out the oldest leads first', () => {
  // Holdings arrive oldest-first, so the front of the list is what moves. The stale
  // records are the ones that need somebody with capacity.
  const plan = planMoves([hold('a', 4, 'old'), hold('b', 0)], { tolerance: 0 });

  assert.deepEqual(
    plan.moves.map((m) => m.leadId),
    ['old-0', 'old-1'],
  );
});

test('caps a run and reports what it held back', () => {
  const plan = planMoves([hold('a', 2000), hold('b', 0)], { tolerance: 0, limit: 200 });

  assert.equal(plan.moves.length, 200);
  assert.equal(plan.deferred, 800); // wanted 1000 to reach the target of 1000
  assert.equal(plan.after.a, 1800);
});

test('is deterministic across identical runs', () => {
  const build = (): Holding[] => [hold('c', 40), hold('a', 40), hold('b', 1), hold('d', 1)];
  const first = planMoves(build(), { tolerance: 0 });
  const second = planMoves(build(), { tolerance: 0 });

  assert.deepEqual(first.moves, second.moves);
});

test('ties break on address so the plan cannot flip between runs', () => {
  const plan = planMoves([hold('b', 40), hold('a', 40), hold('z', 0), hold('y', 0)], { tolerance: 0 });

  // Both donors hold the same surplus and both receivers the same need, so the order is
  // alphabetical: y is filled first, from a.
  assert.equal(plan.moves[0].to, 'y');
  assert.equal(plan.moves[0].from, 'a');
});

test('does nothing when everyone is already equal', () => {
  const plan = planMoves([hold('a', 7), hold('b', 7), hold('c', 7)], { tolerance: 0 });

  assert.equal(plan.moves.length, 0);
  assert.equal(plan.deferred, 0);
  assert.deepEqual(plan.after, plan.before);
});

test('does nothing with nobody eligible', () => {
  // A misconfigured owner list must be a no-op, not a crash or a mass unassignment.
  const plan = planMoves([hold(null, 50, 'free')], { tolerance: 0 });

  assert.equal(plan.moves.length, 0);
  assert.equal(plan.fairShare, 0);
});

test('one person cannot be rebalanced against themselves', () => {
  const plan = planMoves([hold('a', 500)], { tolerance: 0 });

  assert.equal(plan.moves.length, 0);
  assert.equal(plan.target, 500);
});

test('conserves the total number of leads', () => {
  const holdings = [hold('a', 37), hold('b', 12), hold('c', 0), hold(null, 5, 'free')];
  const plan = planMoves(holdings, { tolerance: 0 });

  const sum = (r: Record<string, number>) => Object.values(r).reduce((n, v) => n + v, 0);
  assert.equal(sum(plan.after), sum(plan.before));
  // And no lead is moved twice.
  assert.equal(new Set(plan.moves.map((m) => m.leadId)).size, plan.moves.length);
});

test('never moves a lead to the person who already holds it', () => {
  const plan = planMoves([hold('a', 30), hold('b', 2), hold('c', 1)], { tolerance: 0 });

  assert.ok(plan.moves.every((m) => m.from !== m.to));
});

test('the real shape of this workspace: one huge holder, everyone else short', () => {
  // vidhi holds 2,001 of the 2,886 untouched leads; hardik, the most loaded person by open
  // leads overall, holds 5 of them. Capped at 200, the first run must take only from vidhi.
  const plan = planMoves(
    [
      hold('vidhi', 2001),
      hold('zoho', 285),
      hold('prateek', 99),
      hold('sadhana', 59),
      hold('hardik', 5),
      hold('rikshita', 0),
    ],
    { tolerance: 0.1, limit: 200 },
  );

  assert.equal(plan.moves.length, 200);
  assert.ok(plan.moves.every((m) => m.from === 'vidhi'));
  assert.ok(plan.deferred > 0);
});
