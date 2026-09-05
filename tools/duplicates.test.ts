import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseSurvivor, findCandidates, pairKey, pairsByKey, RULE_CONFIDENCE } from '../lib/duplicates.ts';
import { isMachineAddress } from '../lib/dedupe.ts';
import { normalizePhone } from '../lib/phone.ts';

const at = (iso: string) => new Date(iso);

// The oldest record is the conventional survivor and it is the wrong default here: this
// workspace re-imported its CRM, so the older row is often a bare stub while the newer
// one carries the deals, the activity log and the corrected spelling. A live scan found
// "Aman kumar Singh" with six linked records beside "aman kumarsingh" with none.
test('the record carrying the history survives, not the older one', () => {
  const stub = { id: 'a', createdAt: at('2025-01-01'), weight: 0 };
  const real = { id: 'b', createdAt: at('2026-01-01'), weight: 6 };
  assert.deepEqual(chooseSurvivor(stub, real), [real, stub]);
  assert.deepEqual(chooseSurvivor(real, stub), [real, stub]);
});

test('with nothing to choose between them the older one survives', () => {
  const older = { id: 'a', createdAt: at('2025-01-01'), weight: 2 };
  const newer = { id: 'b', createdAt: at('2026-01-01'), weight: 2 };
  assert.deepEqual(chooseSurvivor(newer, older), [older, newer]);
});

// A queue whose proposed survivor changed between two page loads would be unreviewable.
test('the choice is total and stable even for identical records', () => {
  const a = { id: 'a', createdAt: at('2026-01-01'), weight: 0 };
  const b = { id: 'b', createdAt: at('2026-01-01'), weight: 0 };
  assert.deepEqual(chooseSurvivor(a, b), [a, b]);
  assert.deepEqual(chooseSurvivor(b, a), [a, b]);
});

test('a pair has one key whichever way round it is given', () => {
  assert.equal(pairKey('a', 'b'), pairKey('b', 'a'));
});

// A normalisation bug that mapped four thousand records onto one key would otherwise emit
// eight million pairs. The cap makes that fail visibly — as a group that produced nothing
// — rather than by exhausting the database.
test('an implausibly large group is skipped rather than exploded into pairs', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, createdAt: at('2026-01-01') }));
  assert.equal(pairsByKey(many, () => 'self-employed').length, 0);

  // Two is a duplicate; forty sharing a job title is not.
  const two = many.slice(0, 2);
  assert.equal(pairsByKey(two, () => 'acme').length, 1);
});

// Three records sharing an address are three decisions, not one: a reviewer may well
// judge two of them the same person and the third a colleague, and a cluster interface
// offers no way to say that.
test('a group of three becomes three pairs, not one cluster', () => {
  const three = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, createdAt: at('2026-01-01') }));
  assert.equal(pairsByKey(three, () => 'k').length, 3);
});

// A pair matched by both email and domain is one decision. Emitted twice, the reviewer
// sees the same question under two headings and learns to skim.
test('a pair matched twice is proposed once, under the stronger rule', () => {
  const found = findCandidates('lead', [
    { id: 'a', email: 'priya@acme.com', createdAt: at('2026-01-01') },
    { id: 'b', email: 'priya@acme.com', createdAt: at('2026-02-01') },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'email');
  assert.equal(found[0].confidence, RULE_CONFIDENCE.email);
});

// Grouping by a free provider's domain would propose merging the 19,734 leads that use
// gmail.com into one another.
test('a free email provider is not a company', () => {
  const found = findCandidates('lead', [
    { id: 'a', email: 'one@gmail.com', createdAt: at('2026-01-01') },
    { id: 'b', email: 'two@gmail.com', createdAt: at('2026-02-01') },
  ]);
  assert.equal(found.length, 0);
});

test('a shared company domain is proposed, and more weakly than a shared address', () => {
  const found = findCandidates('lead', [
    { id: 'a', email: 'priya@acme.com', createdAt: at('2026-01-01') },
    { id: 'b', email: 'raj@acme.com', createdAt: at('2026-02-01') },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'domain');
  assert.ok(found[0].confidence < RULE_CONFIDENCE.email);
});

// Numbers arrive as somebody typed them, so the same person's number is three different
// strings. A leading +91 is written on some records and omitted on others.
test('a phone number is matched on the digits that identify it', () => {
  assert.equal(normalizePhone('+91 98101 89048'), '9810189048');
  assert.equal(normalizePhone('9810189048'), '9810189048');
  assert.equal(normalizePhone('(917) 981-9599'), '9179819599');
  // A five-digit extension is not an identity, and grouping on one would propose merging
  // everybody who shares it.
  assert.equal(normalizePhone('98101'), null);
  assert.equal(normalizePhone(null), null);
});

// The first live scan filled all 200 queue slots with pairs of Zoho Campaigns bounce
// addresses — VERP local parts where the `+` tag is the identity, so normalizeEmail
// collapsed twenty-four distinct senders onto one — and pushed every genuine duplicate
// off the page.
test('machine addresses are kept out of the queue', () => {
  assert.ok(isMachineAddress('campaign_913867674+zcreply.1164c300d20bf7a0d@zcsend.net'));
  assert.ok(isMachineAddress('notifications@zohoprojects.in'));
  assert.ok(isMachineAddress('no-reply@example.com'));
  assert.ok(isMachineAddress('anything@mail.anthropic.com'));
  assert.ok(isMachineAddress('anything@e.zoom.us'));

  // A person at a real company is not one, however corporate the domain looks.
  assert.equal(isMachineAddress('priya@acme.com'), false);
  assert.equal(isMachineAddress('someone@gmail.com'), false);
  assert.equal(isMachineAddress('emily@blackstone.com'), false);
  assert.equal(isMachineAddress(null), false);
});

// The ordering is the whole of the merge's safety argument: reversed, a failure halfway
// through leaves the deals of a deleted lead pointing at nothing, and `onDelete: SetNull`
// severs them quietly rather than failing loudly.
test('children are re-pointed before the duplicate is deleted, in one transaction', () => {
  const source = readFileSync('lib/duplicate-queue.ts', 'utf8');
  const move = source.indexOf('opportunity.updateMany({ where: { leadId: duplicateId }');
  const remove = source.indexOf('tx.lead.delete');
  assert.ok(move > -1 && remove > -1);
  assert.ok(move < remove, 'the delete must come after every child has moved');
  assert.match(source, /\$transaction/);
});

// A company carries a Customer row and its revenue history, and `Customer.companyId` is
// unique — so two customers cannot become one without deciding which won date and which
// revenue survives. That is a business decision, not a data operation.
test('company merges are refused rather than guessed', () => {
  const source = readFileSync('lib/duplicate-queue.ts', 'utf8');
  assert.match(source, /entityType === 'company'/);
  assert.match(source, /not automated/);
});

// Without this every scan would re-propose a pair somebody has already looked at and
// rejected, and the queue would never empty.
test('a resolved pair is never proposed again', () => {
  const source = readFileSync('lib/duplicate-queue.ts', 'utf8');
  assert.match(source, /skipDuplicates: true/);
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /@@unique\(\[entityType, primaryId, duplicateId\]\)/);
});
