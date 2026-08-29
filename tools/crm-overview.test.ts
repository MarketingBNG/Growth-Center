import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateOf } from '../lib/crm-overview.ts';

// The CRM screen groups on the wording the CRM itself uses, so these are that account's
// real Lead_Status values rather than invented ones.

test('each of the four columns claims its own statuses', () => {
  assert.equal(stateOf('Semi-Qualified Lead'), 'sq');
  assert.equal(stateOf('Qualified'), 'sq');
  assert.equal(stateOf('Follow-up'), 'followup');
  assert.equal(stateOf('Not Reachable'), 'cnr');
  assert.equal(stateOf('Dead Lead'), 'dead');
  assert.equal(stateOf('Lead Lost'), 'dead');
});

test('"Not Qualified" is not a qualified lead', () => {
  // It contains the word, so without an exclusion it would be counted as SQ — the same
  // ordering trap that put every unqualified lead in the qualified bucket before.
  assert.equal(stateOf('Not Qualified'), 'other');
});

test('an unrecognised or missing status is counted, not dropped', () => {
  assert.equal(stateOf('Untouched Lead'), 'other');
  assert.equal(stateOf('Looking For Job'), 'other');
  assert.equal(stateOf(null), 'other');
  assert.equal(stateOf(''), 'other');
});
