import assert from 'node:assert/strict';
import { recordId } from '../lib/id.ts';
import { test } from 'node:test';
import { stateOf } from '../lib/crm-overview.ts';

// The CRM screen groups on the wording the CRM itself uses, so these are that account's
// real Lead_Status values rather than invented ones.

test('each of the four columns claims its own statuses', () => {
  assert.equal(stateOf('Semi-Qualified Lead'), 'sq');
  assert.equal(stateOf('Follow-up'), 'followup');
  assert.equal(stateOf('Not Reachable'), 'cnr');
  assert.equal(stateOf('Dead Lead'), 'dead');
  assert.equal(stateOf('Lead Lost'), 'dead');
});

test('plain "Qualified" is not semi-qualified', () => {
  // The SQ column is labelled Semi-qualified, and Zoho's "Qualified" is a further stage
  // that ten leads carry. Matching on the substring folded them into a column that says
  // something different about them.
  assert.equal(stateOf('Qualified'), 'other');
  assert.equal(stateOf('Semi Qualified'), 'sq');
});

test('"Not Qualified" is not a qualified lead', () => {
  // It contains the word, so without an exclusion it would be counted as SQ — the same
  // ordering trap that put every unqualified lead in the qualified bucket before.
  assert.equal(stateOf('Not Qualified'), 'other');
});

test('a lead nobody has picked up is its own state, not the leftover bucket', () => {
  // 2,910 leads carry this, and it used to land in Other — which reported the CRM's
  // clearest signal, that nobody has touched these yet, as "unclassified".
  assert.equal(stateOf('Untouched Lead'), 'untouched');
  assert.equal(stateOf('Not Contacted'), 'untouched');
});

test('an unrecognised or missing status is counted, not dropped', () => {
  assert.equal(stateOf('Looking For Job'), 'other');
  assert.equal(stateOf(null), 'other');
  assert.equal(stateOf(''), 'other');
});

// The ids in this database come from two places: Prisma's cuid() for rows this app
// writes, and Postgres' gen_random_uuid() for everything the sync inserts. A validator
// that took only the first rejected every note and task aimed at a synced record.
test('recordId accepts both the ids this database actually holds', () => {
  assert.equal(recordId.safeParse('cmtgw9v3a00019kbnfzq693bu').success, true);
  assert.equal(recordId.safeParse('bfd6be4c-55d5-4344-8cd3-91a819b63ec5').success, true);
});

test('recordId still refuses what is not an id', () => {
  assert.equal(recordId.safeParse('').success, false);
  assert.equal(recordId.safeParse("x'; drop table company; --").success, false);
  assert.equal(recordId.safeParse('a'.repeat(65)).success, false);
});
