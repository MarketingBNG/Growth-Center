import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnTo } from '../lib/return-to.ts';

// `?from=` is set by middleware but arrives in the URL, so it is an input-validation
// boundary: a crafted sign-in link must not be able to bounce someone off the site the
// moment they authenticate.

test('an ordinary path is kept, so people land where they were headed', () => {
  assert.equal(safeReturnTo('/leads'), '/leads');
  assert.equal(safeReturnTo('/crm?tab=contacts'), '/crm?tab=contacts');
});

test('anything that could leave the site falls back to the dashboard', () => {
  // Both are valid pathnames a browser reads as another origin.
  assert.equal(safeReturnTo('//evil.example'), '/');
  assert.equal(safeReturnTo('/\\evil.example'), '/');
  assert.equal(safeReturnTo('https://evil.example'), '/');
  assert.equal(safeReturnTo('javascript:alert(1)'), '/');
});

test('missing or relative values fall back rather than throwing', () => {
  assert.equal(safeReturnTo(undefined), '/');
  assert.equal(safeReturnTo(null), '/');
  assert.equal(safeReturnTo(''), '/');
  assert.equal(safeReturnTo('leads'), '/');
});

test('signing in does not send you back to the sign-in page', () => {
  assert.equal(safeReturnTo('/signin'), '/');
  assert.equal(safeReturnTo('/signin?from=%2Fleads'), '/');
});
