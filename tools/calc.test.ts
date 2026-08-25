import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineValue } from '../lib/calc.ts';

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
