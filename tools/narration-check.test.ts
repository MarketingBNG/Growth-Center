import assert from 'node:assert/strict';
import test from 'node:test';

import { unsupportedIdentifiers } from '../lib/narration-check.ts';

// The evidence one low-CTR finding actually carries.
const seoEvidence = {
  url: 'https://usaindiacfo.com/all-you-need-to-know-about-fatca/',
  title: 'All you need to know about FATCA',
  impressions: 1334,
  clicks: 0,
  ctrPercent: 0,
  averagePosition: 76.35,
};

// ── the defect this was built for ─────────────────────────────────────────────────────

// D1, exactly as it was stored: one extra letter in a domain, in fluent prose, against
// evidence that had it right.
test('a domain the finding never supplied is reported', () => {
  const body = 'The page https://usaindiancfo.com/all-you-need-to-know-about-fatca/ received 1,334 impressions.';
  assert.deepEqual(unsupportedIdentifiers(body, seoEvidence), [
    'https://usaindiancfo.com/all-you-need-to-know-about-fatca/',
  ]);
});

test('the URL as given passes', () => {
  const body = 'The page https://usaindiacfo.com/all-you-need-to-know-about-fatca/ received 1,334 impressions.';
  assert.deepEqual(unsupportedIdentifiers(body, seoEvidence), []);
});

// ── what must not be reported ─────────────────────────────────────────────────────────

// The check runs on every insight, so a false positive silently downgrades a good
// narration to rule wording. These are the shapes that would cause one.

test('figures are not identifiers', () => {
  const body = 'CTR sat at 0.72% against 1,534.5 impressions and an average position of 6.98.';
  assert.deepEqual(unsupportedIdentifiers(body, { ctrPercent: 0.72 }), []);
});

test('an abbreviation is not a host', () => {
  assert.deepEqual(unsupportedIdentifiers('Some pages, e.g. the guides, rank well.', {}), []);
});

test('a scheme and a trailing slash do not count as a difference', () => {
  const evidence = { url: 'example.com/page' };
  assert.deepEqual(unsupportedIdentifiers('See https://example.com/page/ for detail.', evidence), []);
});

test('case does not count as a difference', () => {
  assert.deepEqual(unsupportedIdentifiers('See Usaindiacfo.com today.', { url: 'usaindiacfo.com' }), []);
});

test('sentence punctuation after a host is trimmed', () => {
  assert.deepEqual(unsupportedIdentifiers('The site is usaindiacfo.com.', { url: 'usaindiacfo.com' }), []);
});

test('a host quoted from a nested evidence value passes', () => {
  const evidence = { pages: [{ url: 'https://usaindiacfo.com/stripe-for-indian-us-companies/' }] };
  assert.deepEqual(
    unsupportedIdentifiers('Traffic to usaindiacfo.com/stripe-for-indian-us-companies/ is flat.', evidence),
    [],
  );
});

// ── other identifier shapes ───────────────────────────────────────────────────────────

test('an invented email address is reported', () => {
  const evidence = { ownerEmail: 'gaurav@usaindiacfo.com' };
  assert.deepEqual(unsupportedIdentifiers('Assigned to gurav@usaindiacfo.com.', evidence), [
    'gurav@usaindiacfo.com',
  ]);
});

test('every invented identifier is reported, once each', () => {
  const body = 'Compare bad-one.com with bad-two.com, and bad-one.com again.';
  assert.deepEqual(unsupportedIdentifiers(body, {}), ['bad-one.com', 'bad-two.com']);
});

test('a narration naming nothing at all passes', () => {
  assert.deepEqual(unsupportedIdentifiers('Impressions rose while clicks did not.', {}), []);
});
