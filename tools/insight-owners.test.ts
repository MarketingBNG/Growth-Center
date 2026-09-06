import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  OWNER_DOMAINS,
  RULE_DOMAIN,
  ownerFor,
  unboundDomains,
  type OwnerBindings,
} from '../lib/insight-owners.ts';
import { RULE_IDS } from '../lib/insight-rules.ts';

// D7: "Insights carry an owner only for task and lead items; the rest are unowned."

test('every desk a rule routes to is a real desk', () => {
  for (const [ruleId, domain] of Object.entries(RULE_DOMAIN)) {
    assert.ok(domain in OWNER_DOMAINS, `${ruleId} → ${domain}`);
  }
});

test('every rule in the map is a rule that exists', () => {
  for (const ruleId of Object.keys(RULE_DOMAIN)) {
    assert.ok((RULE_IDS as readonly string[]).includes(ruleId), ruleId);
  }
});

// The three left out on purpose. Their findings name a person from their own data, and
// the lead's own owner is a better answer than their desk's — routing an SLA breach to a
// manager instead of to whoever holds the lead is how a queue stops being workable.
test('rules that find their own owner are not routed to a desk', () => {
  for (const ruleId of ['stale_deals', 'lead_sla_breach', 'task_debt']) {
    assert.equal(RULE_DOMAIN[ruleId], undefined, ruleId);
  }
});

// ── binding ──────────────────────────────────────────────────────────────────────────

const bound: OwnerBindings = { seo: 'dakshita@usaindiacfo.com' };

test('a bound desk gives its rules an owner', () => {
  assert.equal(ownerFor('high_impression_low_ctr_page', bound), 'dakshita@usaindiacfo.com');
});

// Two different situations, one return value, and the caller reports the second. An
// address for either would be inventing one — which is the whole reason the manual's
// named map could not simply be written into the code: Gaurav, Krati, Dakshita, Islam and
// Riyaz hold no account in this workspace and own no record in the CRM.
test('an unbound desk and an unrouted rule both yield nobody', () => {
  assert.equal(ownerFor('high_impression_low_ctr_page', {}), null);
  assert.equal(ownerFor('lead_sla_breach', bound), null);
});

test('the unbound desks are what the configuration finding names', () => {
  const unbound = unboundDomains(bound);
  assert.ok(!unbound.includes('seo'));
  assert.ok(unbound.includes('paid'));
  // Only desks something actually routes to. A desk no rule uses is not a gap.
  const routed = new Set(Object.values(RULE_DOMAIN));
  for (const d of unbound) assert.ok(routed.has(d), d);
});

// ── the rule that reports the gap ────────────────────────────────────────────────────

const rules = readFileSync('lib/insight-rules.ts', 'utf8');

test('an incomplete map is raised once, not as a null on every finding', () => {
  assert.match(rules, /ruleId: 'owner_map_incomplete'/);
  assert.match(rules, /unassignedDomains: unbound/);
});

// It says nobody is bound, so binding it to somebody would be answering its own
// complaint.
test('the configuration finding is itself unowned', () => {
  const block = rules.slice(rules.indexOf("ruleId: 'owner_map_incomplete'"));
  assert.match(block.slice(0, 900), /ownerEmail: null/);
});

// A rule that found a person keeps them.
test('the desk never overwrites an owner the rule found', () => {
  assert.match(rules, /ownerEmail: f\.ownerEmail \?\? ownerFor\(rule\.id, owners\)/);
});
