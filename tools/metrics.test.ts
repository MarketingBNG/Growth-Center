import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cac, costPer, ctr, delta, num, rate, roas } from '../lib/calc.ts';
import { bucketKey, liveDays, previousOf, rangeFor, windowFor } from '../lib/metrics.ts';

// Rates return null, not 0, when there is no denominator. A 0% CTR on a campaign that
// served no impressions is a false statement, and it would drag any average down.
test('rate returns null with a zero denominator', () => {
  assert.equal(rate(5, 0), null);
  assert.equal(ctr(0, 0), null);
});

test('rate computes a percentage', () => {
  assert.equal(rate(25, 200), 12.5);
  assert.equal(ctr(3, 100), 3);
});

test('cac is null when nothing was won', () => {
  assert.equal(cac(50000, 0), null);
  assert.equal(cac(50000, 5), 10000);
});

test('cac is null when nothing was spent, not zero', () => {
  // Twelve customers from an organic channel divided to 0 and the table said acquiring
  // them cost nothing. Only paid channels carry spend, so every organic row said it.
  assert.equal(cac(0, 12), null);
  assert.equal(costPer(0, 350), null);
  assert.equal(costPer(70000, 350), 200);
});

test('roas is null when nothing was spent', () => {
  // Organic revenue has no ROAS; reporting Infinity would break every sort and format.
  assert.equal(roas(90000, 0), null);
  assert.equal(roas(90000, 30000), 3);
});

test('delta is null without a baseline', () => {
  assert.equal(delta(10, 0), null);
  assert.equal(delta(150, 100), 50);
  assert.equal(delta(50, 100), -50);
});

test('num coerces Prisma Decimal-like values and rejects rubbish', () => {
  assert.equal(num({ toString: () => '1234.5' }), 1234.5);
  assert.equal(num('42'), 42);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num('not a number'), 0);
  assert.equal(num(Infinity), 0);
});

test('rangeFor returns a window of the requested length', () => {
  const { current } = rangeFor(30, new Date('2026-08-25T12:00:00Z'));
  // from is 00:00:00.000 and to is 23:59:59.999, so the span rounds to the full 30.
  const days = Math.round((current.to.getTime() - current.from.getTime()) / 86400000);
  assert.equal(days, 30);
  assert.equal(current.from.toISOString().slice(0, 10), '2026-07-27');
  assert.equal(current.to.toISOString().slice(0, 10), '2026-08-25');
});

// The previous window must not overlap the current one, or a delta compares a period
// against part of itself.
test('rangeFor previous window abuts but never overlaps current', () => {
  const { current, previous } = rangeFor(7, new Date('2026-08-25T12:00:00Z'));
  assert.ok(previous.to < current.from, 'previous ends before current begins');
  const gapHours = (current.from.getTime() - previous.to.getTime()) / 3600000;
  assert.ok(gapHours < 1, 'the two windows abut');
  const prevDays = Math.round((previous.to.getTime() - previous.from.getTime()) / 86400000);
  assert.equal(prevDays, 7);
});

// The trend queries bucket dates in Postgres with to_char(date_trunc(...)), and the
// keys they produce have to match the ones emptyBuckets() builds in JavaScript — a
// mismatch would silently drop every row into a bucket nobody renders. bucketKey is the
// shape both sides agree on: 'YYYY-MM-DD' for a day, 'YYYY-MM' for a month, in UTC.
test('bucketKey is the format the SQL date_trunc must produce', () => {
  const d = new Date('2026-03-09T23:45:00.000Z');
  assert.equal(bucketKey(d, 'day'), '2026-03-09');
  assert.equal(bucketKey(d, 'month'), '2026-03');
});

test('bucketKey reads dates in UTC, never local time', () => {
  // 23:45 UTC is already the next day in much of the world. The database column is
  // `timestamp without time zone` holding UTC, so UTC is the only correct reading —
  // and this is what makes date_trunc agree without an AT TIME ZONE conversion.
  assert.equal(bucketKey(new Date('2026-12-31T23:59:59.999Z'), 'day'), '2026-12-31');
  assert.equal(bucketKey(new Date('2026-12-31T23:59:59.999Z'), 'month'), '2026-12');
  assert.equal(bucketKey(new Date('2027-01-01T00:00:00.000Z'), 'day'), '2027-01-01');
});

// A hand-picked window has to reach the KPI cards, not just the figures a page computes
// for itself — the CRM band showed the last thirty days beside a panel showing June.
test('windowFor passes a picked range through untouched', () => {
  const picked = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59.999Z') };
  const { current, previous } = windowFor(picked);
  assert.equal(current.from.toISOString(), '2026-06-01T00:00:00.000Z');
  assert.equal(current.to.toISOString(), '2026-06-30T23:59:59.999Z');
  // The comparison period is the same length, ending the instant before it starts.
  assert.equal(previous.to.toISOString(), '2026-05-31T23:59:59.999Z');
  assert.equal(previous.from.toISOString(), '2026-05-02T00:00:00.000Z');
});

test('windowFor still resolves a day count the way rangeFor does', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  assert.deepEqual(windowFor(7, now), rangeFor(7, now));
});

test('previousOf never overlaps the range it precedes', () => {
  const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59.999Z') };
  const prev = previousOf(range);
  assert.ok(prev.to < range.from);
  assert.equal(prev.to.getTime() + 1, range.from.getTime());
  assert.equal(prev.to.getTime() - prev.from.getTime(), range.to.getTime() - range.from.getTime());
});

// Budget pacing divided a whole period's spend by a single day's budget and reported
// 906.9%: Meta quotes a daily budget, and summing those raw compares a month of one
// against a day of the other. What a range permitted is the daily figure times the days
// the campaign was live in it.
test('liveDays counts the overlap, both ends included', () => {
  const range = { from: new Date('2026-08-02T00:00:00Z'), to: new Date('2026-08-31T23:59:59.999Z') };

  // Open-ended and started long ago: the whole range.
  assert.equal(liveDays({ startDate: new Date('2025-10-17T00:00:00Z'), endDate: null }, range), 30);

  // Started partway through, still running.
  assert.equal(liveDays({ startDate: new Date('2026-08-22T00:00:00Z'), endDate: null }, range), 10);

  // Ran for six days inside the range and stopped.
  assert.equal(
    liveDays(
      { startDate: new Date('2026-08-10T00:00:00Z'), endDate: new Date('2026-08-15T00:00:00Z') },
      range,
    ),
    6,
  );

  // No dates at all is the whole range, matching the overlap query that selected it.
  assert.equal(liveDays({ startDate: null, endDate: null }, range), 30);
});

test('liveDays never returns zero, so pacing cannot divide by it', () => {
  const range = { from: new Date('2026-08-02T00:00:00Z'), to: new Date('2026-08-31T23:59:59.999Z') };
  // A campaign that ended before the range began is filtered out upstream; if one ever
  // reaches here it must not zero the denominator for every other campaign in the sum.
  assert.equal(liveDays({ startDate: null, endDate: new Date('2026-07-01T00:00:00Z') }, range), 1);
});
