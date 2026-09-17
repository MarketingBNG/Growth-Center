import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunks, placeholders } from './script.ts';

// The three backfills that write in batches each built their own VALUES placeholder list,
// each with its own `$${n * K + c}` arithmetic. Off-by-one there does not throw: it binds a
// value to the neighbouring column, so a backfill writes real values into the wrong fields
// and reports success. These assert the shared builder reproduces what each hand-rolled
// version produced, character for character.

test('placeholders matches the five-column form backfill-deal-origin used', () => {
  const byHand = (rows: number) =>
    Array.from(
      { length: rows },
      (_, n) => `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5}::int)`,
    ).join(', ');

  for (const rows of [1, 2, 3, 17, 500]) {
    assert.equal(placeholders(rows, [null, null, null, null, 'int']), byHand(rows));
  }
});

test('placeholders matches the six-column form backfill-lead-quality used', () => {
  const byHand = (rows: number) =>
    Array.from(
      { length: rows },
      (_, n) =>
        `($${n * 6 + 1}, $${n * 6 + 2}::int, $${n * 6 + 3}::int, $${n * 6 + 4}, $${n * 6 + 5}, $${n * 6 + 6})`,
    ).join(', ');

  for (const rows of [1, 2, 3, 17, 500]) {
    assert.equal(placeholders(rows, [null, 'int', 'int', null, null, null]), byHand(rows));
  }
});

test('placeholders matches the two-column form backfill-deal-attribution used', () => {
  const byHand = (rows: number) =>
    Array.from({ length: rows }, (_, n) => `($${n * 2 + 1}, $${n * 2 + 2})`).join(', ');

  for (const rows of [1, 2, 3, 17, 500]) {
    assert.equal(placeholders(rows, [null, null]), byHand(rows));
  }
});

test('placeholders numbers every parameter once, in order', () => {
  // The property the three cases above are specific instances of: whatever the shape, the
  // numbers run 1..rows*columns with none repeated and none skipped — which is exactly
  // what flatMap()ing the values produces on the other side of the call.
  for (const casts of [[null], [null, 'int'], [null, null, null, null, 'int']] as const) {
    const sql = placeholders(7, casts);
    const numbers = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(
      numbers,
      Array.from({ length: 7 * casts.length }, (_, i) => i + 1),
    );
  }
});

test('placeholders can start from an offset', () => {
  assert.equal(placeholders(2, [null, null], 5), '($5, $6), ($7, $8)');
});

test('chunks splits without losing or duplicating an item', () => {
  const items = Array.from({ length: 1001 }, (_, i) => i);
  for (const size of [1, 2, 500, 1000, 1001, 2000]) {
    const out = chunks(items, size);
    assert.deepEqual(out.flat(), items);
    assert.ok(out.every((c) => c.length <= size));
    assert.ok(out.slice(0, -1).every((c) => c.length === size));
  }
  assert.deepEqual(chunks([], 500), []);
});
