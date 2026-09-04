import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REDACTED,
  describeRedactions,
  hasRedactions,
  omitFor,
  redactedInFields,
  redactedInFilter,
  refusal,
  withoutRedacted,
} from '../lib/ai-redaction.ts';
import { TABLES } from '../lib/ai-tools.ts';

// §20.7: "No taxpayer PII in any prompt."
//
// A redaction is only as good as the narrowest hole in it. These test the holes rather
// than the happy path: the returned columns are the obvious half, and a `where`, a `by`
// and an `orderBy` each recover a hidden value by a different route.

test('every redacted table is one the model can actually read', () => {
  for (const table of Object.keys(REDACTED)) {
    assert.ok(table in TABLES, `${table} is redacted but not in the allowlist`);
  }
});

// Staff addresses are how ownership questions get answered at all, and the findings name
// them by design. Redacting them would break the feature to protect colleagues who are
// already on every screen.
test('staff addresses are not redacted', () => {
  for (const [table, fields] of Object.entries(REDACTED)) {
    for (const staff of ['ownerEmail', 'assigneeEmail', 'actorEmail', 'authorEmail', 'createdByEmail']) {
      assert.ok(!fields.includes(staff), `${table}.${staff} should stay readable`);
    }
  }
});

// A company is not a person, and the firm's clients are businesses whose names are the
// subject of every revenue question.
test('company and campaign names stay readable', () => {
  assert.ok(!(REDACTED.company ?? []).includes('name'));
  assert.ok(!(REDACTED.lead ?? []).includes('companyName'));
});

test('an unredacted table omits nothing', () => {
  assert.equal(omitFor('opportunity'), undefined);
  assert.equal(hasRedactions('opportunity'), false);
  assert.equal(hasRedactions('lead'), true);
});

test('the omit clause names every redacted field', () => {
  assert.deepEqual(omitFor('contact'), {
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    linkedin: true,
  });
});

// ── The holes ─────────────────────────────────────────────────────────────────────────

// Removing a column from the output is half a redaction: count with a where on an email
// returns 1 or 0 and reveals the address it was asked about.
test('a filter on a redacted field is caught', () => {
  assert.equal(redactedInFilter('lead', { email: 'someone@example.com' }), 'email');
  assert.equal(redactedInFilter('lead', { status: 'new' }), null);
});

test('a filter nested under a combinator is caught', () => {
  assert.equal(redactedInFilter('lead', { AND: [{ status: 'new' }, { phone: { not: null } }] }), 'phone');
  assert.equal(redactedInFilter('lead', { OR: [{ NOT: { email: { contains: '@gmail' } } }] }), 'email');
});

// The longer route to the same value: a relation filter reaches the contact's email from
// the opportunity table.
test('a filter through a relation is caught', () => {
  assert.equal(redactedInFilter('opportunity', { contact: { is: { email: 'x@y.com' } } }), 'email');
});

test('a deep but clean filter passes', () => {
  assert.equal(
    redactedInFilter('opportunity', { stage: { is: { isWon: true } }, value: { gt: 1000 } }),
    null,
  );
});

test('a malformed or absent filter is not an error', () => {
  assert.equal(redactedInFilter('lead', undefined), null);
  assert.equal(redactedInFilter('lead', null), null);
  assert.equal(redactedInFilter('lead', 'nonsense'), null);
});

// group by email lists every address in the table under the guise of a total.
test('grouping or selecting a redacted field is caught', () => {
  assert.equal(redactedInFields('lead', ['status', 'email']), 'email');
  assert.equal(redactedInFields('lead', ['status', 'channelId']), null);
  assert.equal(redactedInFields('lead', { id: true, email: true }), 'email');
});

// A select that names a field and sets it false is not asking for it.
test('a field switched off in a select is not a request for it', () => {
  assert.equal(redactedInFields('lead', { id: true, email: false }), null);
});

// Ordering leaks too, if less obviously: sorting by email and reading ids back recovers
// the alphabetical order of the addresses.
test('ordering by a redacted field is caught', () => {
  assert.equal(redactedInFields('lead', { email: 'asc' }), 'email');
  assert.equal(redactedInFields('lead', { createdAt: 'desc' }), null);
});

// ── What the model is told ────────────────────────────────────────────────────────────

// Told a field does not exist, a model calls describe_tables, finds it missing and tries
// the next-nearest name. Told it is withheld, it reports the limit to the person asking.
test('the refusal names the field and says what is readable', () => {
  const message = refusal('lead', 'email');
  assert.match(message, /email/);
  assert.match(message, /withheld/);
  assert.match(message, /Counts, values, owners, dates and channels/);
});

test('the limit is advertised before it is hit', () => {
  assert.match(describeRedactions('lead'), /Withheld and not readable: .*email/);
  assert.equal(describeRedactions('opportunity'), '');
});

// Listing a field in the signature and then refusing it invites the model to keep trying.
test('a redacted field is removed from the field signature', () => {
  const signature = withoutRedacted('lead', 'id:String firstName:String email:String? status:LeadStatus');
  assert.equal(signature, 'id:String status:LeadStatus');
});

test('an unredacted table keeps its signature intact', () => {
  const fields = 'id:String value:Decimal stage:PipelineStage';
  assert.equal(withoutRedacted('opportunity', fields), fields);
});

// A prefix must not match: redacting `email` must not also strip `emailVerifiedAt`.
test('only an exact field name is stripped', () => {
  assert.equal(
    withoutRedacted('lead', 'email:String? emailVerifiedAt:DateTime?'),
    'emailVerifiedAt:DateTime?',
  );
});
