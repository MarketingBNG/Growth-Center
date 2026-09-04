import assert from 'node:assert/strict';
import test from 'node:test';

import { COLD_START, deriveFromHistory } from '../lib/deal-origin.ts';
import type { HistoryInput } from '../lib/deal-origin.ts';

// Every fixture sits after the cold-start boundary unless a test is specifically about
// that boundary, so an unrelated test cannot pass for the wrong reason.
const LATER = new Date('2025-03-01T00:00:00Z');
const day = (n: number) => new Date(LATER.getTime() + n * 86_400_000);

function deal(over: Partial<HistoryInput> & { id: string }): HistoryInput {
  return { accountKey: 'acme', createdAt: LATER, origin: 'unknown', ...over };
}

const verdictFor = (id: string, out: ReturnType<typeof deriveFromHistory>) =>
  out.find((v) => v.id === id)?.origin ?? null;

test('the first deal on an account is new business', () => {
  const out = deriveFromHistory([deal({ id: 'a' })]);
  assert.deepEqual(out, [{ id: 'a', origin: 'new', source: 'account-history' }]);
});

test('a later deal on the same account is repeat business', () => {
  const out = deriveFromHistory([
    deal({ id: 'a', createdAt: day(0) }),
    deal({ id: 'b', createdAt: day(10) }),
  ]);
  assert.equal(verdictFor('a', out), 'new');
  assert.equal(verdictFor('b', out), 'repeat');
});

test('order comes from the timestamp, not the order rows arrive in', () => {
  const out = deriveFromHistory([
    deal({ id: 'late', createdAt: day(10) }),
    deal({ id: 'early', createdAt: day(0) }),
  ]);
  assert.equal(verdictFor('early', out), 'new');
  assert.equal(verdictFor('late', out), 'repeat');
});

test('deals on different accounts are each first', () => {
  const out = deriveFromHistory([
    deal({ id: 'a', accountKey: 'acme' }),
    deal({ id: 'b', accountKey: 'globex' }),
  ]);
  assert.equal(verdictFor('a', out), 'new');
  assert.equal(verdictFor('b', out), 'new');
});

test('a deal with no account link is left alone', () => {
  assert.deepEqual(deriveFromHistory([deal({ id: 'a', accountKey: null })]), []);
});

// The point of the whole exercise: the name is better evidence and is never overruled.
test('deals the name already classified get no verdict', () => {
  const out = deriveFromHistory([
    deal({ id: 'named', origin: 'repeat', createdAt: day(0) }),
    deal({ id: 'unnamed', origin: 'unknown', createdAt: day(10) }),
  ]);
  assert.equal(verdictFor('named', out), null);
  assert.equal(verdictFor('unnamed', out), 'repeat');
});

test('a named deal still occupies its place in the account run', () => {
  // Without counting the named deal, 'b' would look like the account's first.
  const out = deriveFromHistory([
    deal({ id: 'a', origin: 'new', createdAt: day(0) }),
    deal({ id: 'b', createdAt: day(10) }),
  ]);
  assert.equal(verdictFor('b', out), 'repeat');
});

// ── The cold start ────────────────────────────────────────────────────────────────────

/** The stamp all 928 imported deals actually carry, not a stand-in. An earlier boundary
 *  of 07-07T00:00Z sat before this and let the whole cohort through as new business. */
const IMPORT_DAY = new Date('2024-07-07T17:00:00Z');

test('the real import stamp falls inside the cold start', () => {
  assert.ok(IMPORT_DAY.getTime() < COLD_START.getTime());
});

test('the first import is never called new business', () => {
  assert.deepEqual(deriveFromHistory([deal({ id: 'a', createdAt: IMPORT_DAY })]), []);
});

test('but a deal after it on the same account is still repeat', () => {
  const out = deriveFromHistory([
    deal({ id: 'imported', createdAt: IMPORT_DAY }),
    deal({ id: 'after', createdAt: LATER }),
  ]);
  assert.equal(verdictFor('imported', out), null);
  assert.equal(verdictFor('after', out), 'repeat');
});

test('the boundary itself counts as after the import', () => {
  const out = deriveFromHistory([deal({ id: 'a', createdAt: COLD_START })]);
  assert.equal(verdictFor('a', out), 'new');
});

test('two deals sharing a timestamp are broken by id, not left both first', () => {
  const out = deriveFromHistory([
    deal({ id: 'b', createdAt: LATER }),
    deal({ id: 'a', createdAt: LATER }),
  ]);
  assert.equal(verdictFor('a', out), 'new');
  assert.equal(verdictFor('b', out), 'repeat');
});

test('a whole account imported on day one yields repeats but no new', () => {
  const out = deriveFromHistory([
    deal({ id: 'a', createdAt: IMPORT_DAY }),
    deal({ id: 'b', createdAt: IMPORT_DAY }),
    deal({ id: 'c', createdAt: IMPORT_DAY }),
  ]);
  assert.equal(out.filter((v) => v.origin === 'new').length, 0);
  assert.equal(out.filter((v) => v.origin === 'repeat').length, 2);
});

test('every verdict says it came from history', () => {
  const out = deriveFromHistory([
    deal({ id: 'a', createdAt: day(0) }),
    deal({ id: 'b', createdAt: day(1) }),
  ]);
  assert.ok(out.length > 0);
  assert.ok(out.every((v) => v.source === 'account-history'));
});

test('contact-keyed and company-keyed accounts do not collide', () => {
  const out = deriveFromHistory([
    deal({ id: 'a', accountKey: 'x' }),
    deal({ id: 'b', accountKey: 'c:x' }),
  ]);
  assert.equal(verdictFor('a', out), 'new');
  assert.equal(verdictFor('b', out), 'new');
});
