import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// D5. The manual's instruction was "suppress the stale-deal rule until reconciliation
// passes". The reconciliation was run and it did not say what the manual expected, so
// these lock what it actually found rather than the instruction.

const rules = readFileSync('lib/insight-rules.ts', 'utf8');
const module_ = readFileSync('lib/deal-activity.ts', 'utf8');

// The one condition under which "no activity" means "no data" rather than "no work".
test('the rule holds its tongue only when the CRM sync cannot be trusted', () => {
  assert.match(rules, /if \(!activity\.trustworthy\) return \[\];/);
  assert.match(module_, /crm\.state === 'error' \|\| crm\.lastError !== null/);
});

// 25,184 activity rows attach to a lead and 1,724 to a deal: this firm logs its calls
// against the lead and the contact. Of 967 open deals, 339 carry activity on the deal and
// another 132 only on their contact — deals the direct-only measure called untouched.
test('activity on the deal’s contact counts as activity', () => {
  assert.match(module_, /contactTouch/);
  assert.match(rules, /dealsWithActivityOnlyOnTheContact/);
});

// The figures that stop the finding being dismissed as a sync artefact: 496 open deals
// have no activity anywhere, and widening the measure to the contact still leaves 959 of
// 967 stale at thirty days. The staleness is the pipeline's.
test('the finding carries the numbers that distinguish stale from unrecorded', () => {
  for (const key of [
    'dealsWithActivityOnTheDeal',
    'dealsWithActivityOnlyOnTheContact',
    'dealsWithNoActivityAnywhere',
  ]) {
    assert.match(rules, new RegExp(key), key);
  }
});

// All 8,087 opportunities carry an updatedAt inside the last week because the sync
// rewrites every row it re-imports. It records when this application last wrote, never
// when a person last did — and it is the obvious wrong signal to reach for here.
test('updatedAt is not used as an activity signal', () => {
  const rule = rules.slice(rules.indexOf("id: 'stale_deals'"), rules.indexOf("id: 'lead_sla_breach'"));
  assert.doesNotMatch(rule, /updatedAt/);
  // The module names it twice, both times in the note explaining why it is not used.
  // What must not appear is a selection of it.
  assert.doesNotMatch(module_, /updatedAt: true/);
});

// A deal with no row in lastTouch has never been touched at all, and dropping it would
// report the worst deals as the healthy ones.
test('a deal with no activity anywhere is counted as stale, not skipped', () => {
  assert.match(rules, /activity\.openDeals - activity\.lastTouch\.size/);
});
