import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeParam } from '../lib/range.ts';

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
