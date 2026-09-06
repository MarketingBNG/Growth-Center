import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { needsSuppressionCheck } from '../lib/suppression.ts';

// §12.5 and Appendix C: "no cold send to a client or referral partner". §7.7 says why it
// is not a metrics problem — a client receiving a cold pitch is a relationship event, and
// the person who notices is the client.

// The gate is written round the other way from the obvious reading, and this is why:
// gating on `purpose === 'cold_acquisition'` checks nothing at all in this workspace,
// because not one of the fifty sequences has a purpose set. A control that silently does
// nothing is worse than no control.
test('an unset purpose is checked, not skipped', () => {
  assert.equal(needsSuppressionCheck(null), true);
  assert.equal(needsSuppressionCheck(undefined), true);
  assert.equal(needsSuppressionCheck(''), true);
});

test('cold acquisition is checked', () => {
  assert.equal(needsSuppressionCheck('cold_acquisition'), true);
});

// Only an explicit declaration exempts a list — which also gives whoever is annoyed by a
// false positive something useful to do about it.
test('a list that says it is for clients is exempt', () => {
  assert.equal(needsSuppressionCheck('client_reminder'), false);
  assert.equal(needsSuppressionCheck('dormant_revival'), false);
});

// ── the three sources ────────────────────────────────────────────────────────────────

const source = readFileSync('lib/suppression.ts', 'utf8');

// Against the live database only the third carries anything: isClient is false on all
// 27,575 leads and no referral partner has an address. Both columns were added for this
// control and never populated. Reading only the one the schema comment points at would
// have produced a check that finds nobody, on data where 236 clients sit on lists.
test('all three sources are read, not just the flags', () => {
  assert.match(source, /db\(\)\.lead\.findMany/);
  assert.match(source, /db\(\)\.referralPartner\.findMany/);
  assert.match(source, /company: \{ is: \{ customer: \{ isNot: null \} \} \}/);
});

// A stored list goes stale in exactly the case that matters: the prospect who became a
// client since the list was built.
test('the check is computed, never a stored list', () => {
  assert.doesNotMatch(source, /suppressionList|SuppressionEntry/);
});

test('one hit per address, and the more serious reason wins', () => {
  assert.match(source, /if \(!hits\.has\(key\)\) hits\.set/);
  // Clients are put in before referral partners, so a person who is both reads as a
  // client — the worse of the two to cold-mail.
  assert.ok(source.indexOf("reason: 'client'") < source.indexOf("reason: 'referral partner'"));
});

// ── the refusal ──────────────────────────────────────────────────────────────────────

// A sign-off is the moment somebody takes responsibility for the list, so it is where the
// refusal belongs — not only on a page somebody might read.
test('signing off a list with suppressed recipients is refused', () => {
  const outreach = readFileSync('lib/outreach.ts', 'utf8');
  assert.match(outreach, /const hits = await suppressionCheck\(id\);/);
  assert.match(outreach, /already has a relationship with/);
});

// Named, not counted. "Three suppressed" is not something anyone can act on; an address
// is.
test('the finding names addresses rather than counting them', () => {
  const rules = readFileSync('lib/insight-rules.ts', 'utf8');
  assert.match(rules, /ruleId is set by the runner|id: 'suppression_breach'/);
  assert.match(rules, /examples: hits\.slice\(0, 5\)/);
  // One of the three the manual reserves `critical` for.
  const block = rules.slice(rules.indexOf("id: 'suppression_breach'"));
  assert.match(block.slice(0, 400), /severity: 'critical'/);
});
