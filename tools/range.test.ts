import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customRange, rangeParam } from '../lib/range.ts';

// rangeParam reads ?range= straight off the URL, so it is an input-validation boundary:
// a hand-edited or crafted value must not reach a query.

test('an allowed range is accepted', () => {
  assert.deepEqual(rangeParam({ range: '7' }), { value: '7', days: 7, bucket: 'day' });
  assert.deepEqual(rangeParam({ range: '90' }), { value: '90', days: 90, bucket: 'day' });
});

test('anything off the allow-list falls back to 30 days', () => {
  for (const bad of [
    '31',
    '99999',
    '-1',
    '0',
    'abc',
    '',
    '7; DROP TABLE lead',
    '1e9',
    '  30  ',
  ]) {
    const r = rangeParam({ range: bad });
    assert.equal(r.value, '30', `"${bad}" should not be honoured`);
    assert.equal(r.days, 30);
  }
});

test('a missing or repeated param falls back rather than throwing', () => {
  assert.equal(rangeParam({}).days, 30);
  // Next gives an array when a query key repeats; only a plain string is trusted.
  assert.equal(rangeParam({ range: ['7', '90'] }).days, 30);
  assert.equal(rangeParam({ range: undefined }).days, 30);
});

test('days is always a finite positive number', () => {
  for (const v of ['7', '30', '90', '365', 'nonsense', undefined]) {
    const { days } = rangeParam({ range: v as string | undefined });
    assert.ok(Number.isFinite(days) && days > 0, `days was ${days} for ${String(v)}`);
  }
});

test('long ranges bucket by month so a chart never draws 365 points', () => {
  assert.equal(rangeParam({ range: '90' }).bucket, 'day');
  assert.equal(rangeParam({ range: '365' }).bucket, 'month');
});

// customRange reads ?from= and ?to= off the URL, so it is the same validation boundary.

test('a custom range needs both ends, well formed', () => {
  assert.equal(customRange({ from: '2026-08-01' }), null, 'half a range is not a range');
  assert.equal(customRange({ to: '2026-08-31' }), null);
  assert.equal(customRange({ from: '2026-8-1', to: '2026-08-31' }), null);
  assert.equal(customRange({ from: 'yesterday', to: 'today' }), null);
  assert.equal(customRange({}), null);
});

test('a custom range covers both days end to end', () => {
  const r = customRange({ from: '2026-08-01', to: '2026-08-31' })!;
  assert.equal(r.from.toISOString(), '2026-08-01T00:00:00.000Z');
  // Inclusive of the last day, or a month's figures would stop at midnight on the 30th.
  assert.equal(r.to.toISOString(), '2026-08-31T23:59:59.999Z');
  assert.equal(r.label, '2026-08-01 – 2026-08-31');
});

test('a backwards custom range is swapped, not refused', () => {
  // Picking the end date first is an ordinary slip, and an empty screen explains nothing.
  const r = customRange({ from: '2026-08-31', to: '2026-08-01' })!;
  assert.equal(r.from.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(r.to.toISOString().slice(0, 10), '2026-08-31');
});

test('an absurd span is refused rather than scanned', () => {
  assert.equal(customRange({ from: '1900-01-01', to: '2026-08-31' }), null);
});

test('today is a single day, and still a valid range', () => {
  assert.deepEqual(rangeParam({ range: 'today' }), { value: 'today', days: 1, bucket: 'day' });
});
