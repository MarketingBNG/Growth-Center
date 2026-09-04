import assert from 'node:assert/strict';
import test from 'node:test';

import { dateKey, parseDateKey, quarterOf } from '../lib/budget.ts';

// The quarter arithmetic decides which spend an envelope is judged against. Every
// off-by-one here is a figure that looks plausible and is wrong by a month.

test('a date lands in its calendar quarter', () => {
  const cases: [string, string, string, string][] = [
    ['2026-01-01', '2026-01-01', '2026-04-01', 'Q1 2026'],
    ['2026-02-14', '2026-01-01', '2026-04-01', 'Q1 2026'],
    ['2026-04-01', '2026-04-01', '2026-07-01', 'Q2 2026'],
    ['2026-09-04', '2026-07-01', '2026-10-01', 'Q3 2026'],
    ['2026-12-31', '2026-10-01', '2027-01-01', 'Q4 2026'],
  ];
  for (const [date, start, end, label] of cases) {
    const q = quarterOf(parseDateKey(date));
    assert.equal(q.periodStart, start, date);
    assert.equal(q.periodEnd, end, date);
    assert.equal(q.label, label, date);
  }
});

// The end is the first day of the NEXT quarter, not the last day of this one. A quarter
// ending on the 30th silently drops the 31st's spend in the quarters that have one.
test('the period end is exclusive', () => {
  assert.equal(quarterOf(parseDateKey('2026-08-15')).periodEnd, '2026-10-01');
});

test('Q4 rolls the year over', () => {
  assert.equal(quarterOf(parseDateKey('2026-11-20')).periodEnd, '2027-01-01');
});

// The boundaries themselves, where an off-by-one puts a day in the wrong quarter and the
// total still looks reasonable.
test('the first and last instant of a quarter both land in it', () => {
  assert.equal(quarterOf(parseDateKey('2026-07-01')).label, 'Q3 2026');
  assert.equal(quarterOf(new Date(2026, 8, 30, 23, 59, 59, 999)).label, 'Q3 2026');
});

test('every quarter is exactly one quarter long', () => {
  for (const month of [0, 3, 6, 9]) {
    const q = quarterOf(new Date(2026, month, 15));
    const start = parseDateKey(q.periodStart);
    const end = parseDateKey(q.periodEnd);
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    assert.equal(months, 3, `month ${month}`);
  }
});

// ── Why the period is text ────────────────────────────────────────────────────────────
//
// It was a Postgres DATE first, and that is the bug these prevent. Prisma wrote the JS
// Date's UTC parts; node-postgres read a DATE back as midnight in the process's own
// timezone. An envelope for Q3 2026 stored as 2026-06-30 in an IST process, and the
// lookup only found it because both halves were wrong in the same direction. A row
// written in one timezone and read in another would not have matched at all, which is
// exactly what dev in IST and production in UTC would have done.

test('a date key survives a round trip', () => {
  for (const key of ['2026-01-01', '2026-07-01', '2026-12-31', '2027-01-01']) {
    assert.equal(dateKey(parseDateKey(key)), key);
  }
});

// The whole reason dateKey exists rather than toISOString().slice(0, 10).
test('dateKey does not shift the day in a timezone ahead of UTC', () => {
  assert.equal(dateKey(new Date(2026, 6, 1)), '2026-07-01');
  // Late enough in the day that a UTC reading would still be on the 1st, and early
  // enough that it would be on the 30th — the two cases the naive version gets wrong.
  assert.equal(dateKey(new Date(2026, 6, 1, 2, 0, 0)), '2026-07-01');
  assert.equal(dateKey(new Date(2026, 6, 1, 23, 0, 0)), '2026-07-01');
});

// Sorting and comparison are why this format and not any other: a period is compared
// against another period as a plain string, in the database and in the domain check.
test('date keys compare and sort as dates', () => {
  assert.ok('2026-07-01' < '2026-10-01');
  assert.ok('2026-09-30' < '2026-10-01');
  assert.ok('2026-12-31' < '2027-01-01');
  const shuffled = ['2027-01-01', '2026-04-01', '2026-10-01', '2026-01-01'];
  assert.deepEqual([...shuffled].sort(), ['2026-01-01', '2026-04-01', '2026-10-01', '2027-01-01']);
});
