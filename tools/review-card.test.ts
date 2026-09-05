import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refusals, reviewCard } from '../lib/review-card.ts';
import { INSIGHTS_PROMPT_VERSION } from '../lib/ai.ts';

// ── §21.4 what must never be approved ────────────────────────────────────────────────

test('an empty subject and a live token are both refused', () => {
  const found = refusals({ subject: '', text: 'Hi {{first_name}}, about your filing…' });
  assert.equal(found.length, 2);
  assert.ok(found.every((r) => r.clause === '§21.4'));
});

// Sent back three times over three separate faults, a reader learns the gate is
// arbitrary. Sent back once with three reasons, they fix all of them.
test('every fault is reported at once, not the first one', () => {
  const found = refusals({
    subject: '[SUBJECT LINE]',
    text: 'The penalty is $25,000. TBD',
    figuresGrounded: false,
    partnerVoice: 'Nilesh',
    suppressionChecked: false,
  });
  assert.ok(found.length >= 4, `expected several refusals, got ${found.length}`);
});

// The distinction between two of §21.3's rows. A figure somebody checked and could not
// ground is a refusal; a figure nobody has checked yet escalates to the CA/CPA reviewer,
// which is a different instruction to a different person.
test('a checked-and-ungrounded figure is refused; an unchecked one is not', () => {
  const text = 'Miss Form 5472 and the penalty is $25,000.';
  assert.equal(refusals({ subject: 'Deadline', text, figuresGrounded: false }).length, 1);
  assert.equal(refusals({ subject: 'Deadline', text, figuresGrounded: null }).length, 0);
  assert.equal(refusals({ subject: 'Deadline', text, figuresGrounded: true }).length, 0);
});

test('a partner-voiced asset needs that partner’s own signature', () => {
  const unsigned = refusals({ subject: 'On tax season', partnerVoice: 'Nilesh' });
  assert.equal(unsigned.length, 1);
  assert.match(unsigned[0].reason, /Nilesh/);

  const signed = refusals({
    subject: 'On tax season',
    partnerVoice: 'Nilesh',
    partnerApprovedAt: new Date(),
  });
  assert.equal(signed.length, 0);
});

// A suppression check nobody has run is not a passed one, but it is also not a failure —
// only an explicit false refuses, so a plain post with no list attached is not blocked by
// a rule about cold sequences.
test('a post with no prospect list is not refused for a suppression check', () => {
  assert.equal(refusals({ subject: 'A post', text: 'Nothing to see' }).length, 0);
  assert.equal(refusals({ subject: 'A sequence', suppressionChecked: false }).length, 1);
});

// ── §21.2 the card ───────────────────────────────────────────────────────────────────

test('the card is read in the manual’s order, criticals first', async () => {
  const card = await reviewCard({ subject: 'A post', text: 'Nothing contentious.' });
  assert.deepEqual(
    card.sections.map((s) => s.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(card.sections[0].title, 'Critical findings');
  assert.ok(card.sections[0].blocking, 'the first section can end the review on its own');
});

// A card with no claims section reads as an asset making no claims, which is precisely
// the reading the section exists to prevent. §20.4 is the one part of the manual that
// cannot be started rather than merely deferred, and the card says so.
test('the claims section says it cannot be filled rather than disappearing', async () => {
  const card = await reviewCard({ subject: 'A post', text: 'Nothing contentious.' });
  const claims = card.sections.find((s) => s.order === 2);
  assert.ok(claims);
  assert.equal(claims.title, 'Claims and grounding');
  assert.match(claims.unavailable ?? '', /no verified corpus/);
});

// §21.3's escalate row, reachable. Written as `!== true` in the refusal list first, this
// path was unreachable and the CA/CPA reviewer would never have been asked.
test('an unverified regulatory figure escalates rather than being returned', async () => {
  const card = await reviewCard({
    subject: 'Form 5472 deadline',
    text: 'Miss Form 5472 and the penalty is $25,000.',
  });
  assert.equal(card.recommendation, 'escalate');
  assert.match(card.reasons.join(' '), /confidence alone/);
});

test('a clean asset is recommended for approval', async () => {
  const card = await reviewCard({ subject: 'Team news', text: 'We have moved office.' });
  assert.equal(card.recommendation, 'approve');
});

// "Hold, and ask for the fortnight — stopping a channel on a week of numbers is a
// decision made on noise."
test('a stop proposal on a week of data is held, not refused', async () => {
  const card = await reviewCard({ subject: 'Stop LinkedIn', proposal: 'stop', cleanDataDays: 5 });
  assert.equal(card.recommendation, 'hold');
  const long = await reviewCard({ subject: 'Stop LinkedIn', proposal: 'stop', cleanDataDays: 30 });
  assert.equal(long.recommendation, 'approve');
});

// ── Appendix B provenance ────────────────────────────────────────────────────────────

// The rule's version was already stored, and that is the half nobody argues about. What
// changed silently was the wording.
test('narrated insights carry the prompt version, and rule-written ones do not', () => {
  const source = readFileSync('lib/ai.ts', 'utf8');
  assert.ok(INSIGHTS_PROMPT_VERSION.length > 0);
  assert.match(source, /promptVersion: narrated \? INSIGHTS_PROMPT_VERSION : null/);
});

// JSON.stringify preserves insertion order, so a rule building its evidence in a
// different order on two runs would hash identical figures differently — and every
// insight would report itself as edited, every night.
test('the context hash is stable against key order', () => {
  const source = readFileSync('lib/ai.ts', 'utf8');
  assert.match(source, /Object\.keys\(evidence\)\s*\n?\s*\.sort\(\)/);
});

// §19.3: "one task per insight, ever". The key is the id and not the title, so a task
// renamed in Zoho Projects stays matched.
test('the insight-to-task link is unique', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /taskId String\? @unique/);
});
