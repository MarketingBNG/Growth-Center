import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  consultationHeld,
  newCustomer,
  qualifiedLead,
  semiQualifiedLead,
} from '../lib/definitions.ts';

const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-03-31T23:59:59Z') };

// K2 asks for the definitions "as named, tested metric functions". They were named
// nowhere, and one of them — a consultation held — was written out twice, as two
// identical queries kept in step by hand. Two copies of one definition is what D11 was.

test('a consultation held is a deal opened in the window', () => {
  assert.deepEqual(consultationHeld(range), {
    createdAt: { gte: range.from, lte: range.to },
  });
});

test('qualified means the CRM stamped it, and nothing more', () => {
  assert.deepEqual(qualifiedLead(range), {
    createdAt: { gte: range.from, lte: range.to },
    qualifiedAt: { not: null },
  });
});

// The figure the dashboard reports, because it is the stage this team works: 2,756 leads
// against the 3 the CRM calls qualified.
test('semi-qualified includes anything that converted', () => {
  const where = semiQualifiedLead(range);
  assert.deepEqual(where.OR, [{ status: 'semi_qualified' }, { qualifiedAt: { not: null } }]);
});

// ── channel scoping ──────────────────────────────────────────────────────────────────

test('every definition narrows to a channel the same way', () => {
  assert.equal(consultationHeld(range, 'ch1').channelId, 'ch1');
  assert.equal(qualifiedLead(range, 'ch1').channelId, 'ch1');
  assert.equal(semiQualifiedLead(range, 'ch1').channelId, 'ch1');
});

test('unscoped, no definition mentions a channel at all', () => {
  for (const where of [consultationHeld(range), qualifiedLead(range), semiQualifiedLead(range)]) {
    assert.ok(!('channelId' in where));
  }
  assert.deepEqual(newCustomer(range), { wonAt: { gte: range.from, lte: range.to } });
});

// The one with a rule in it. A customer whose deal came from a lead belongs to the lead's
// channel; the deal's own channel counts only where there is no lead. Both clauses
// matching would count one customer against two channels — and CAC is a per-channel
// figure, so that inflates one channel's return with another's customers.
test('a customer lands on one channel, lead first and deal second', () => {
  const where = newCustomer(range, 'ch1');
  assert.deepEqual(where.OR, [
    { opportunity: { is: { lead: { is: { channelId: 'ch1' } } } } },
    { opportunity: { is: { lead: { is: null }, channelId: 'ch1' } } },
  ]);
});

// ── one implementation, not two ──────────────────────────────────────────────────────

test('the funnel and the cost card count consultations with the same predicate', () => {
  const metrics = readFileSync('lib/metrics.ts', 'utf8');
  const uses = metrics.match(/consultationHeld\(/g) ?? [];
  assert.ok(uses.length >= 2, `expected both call sites to use it, saw ${uses.length}`);
  // What must not come back: a hand-written copy of the definition beside the named one.
  assert.doesNotMatch(metrics, /opportunity\.count\(\{ where: \{ createdAt: window \} \}\)/);
});
