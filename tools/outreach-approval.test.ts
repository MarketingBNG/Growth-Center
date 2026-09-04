import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayStatus,
  fitness,
  purposeLabel,
  templateHash,
  SEQUENCE_PURPOSES,
} from '../lib/outreach-approval.ts';
import { lintSequence } from '../lib/outreach-lint.ts';

const CLEAN = [
  { position: 1, subject: 'Your US filing deadline', body: 'Hi {{first_name}}, a quick note.' },
  { position: 2, subject: '', body: 'Following up, {{first_name}}.' },
];

const AT = new Date('2026-09-01T10:00:00Z');

const none = {
  copyApprovedByEmail: null,
  copyApprovedAt: null,
  copyApprovedHash: null,
  numbersVerifiedByEmail: null,
  numbersVerifiedAt: null,
  numbersVerifiedHash: null,
};

const signedFor = (steps: typeof CLEAN) => ({
  copyApprovedByEmail: 'shweta@usaindiacfo.com',
  copyApprovedAt: AT,
  copyApprovedHash: templateHash(steps),
  numbersVerifiedByEmail: 'akshay@usaindiacfo.com',
  numbersVerifiedAt: AT,
  numbersVerifiedHash: templateHash(steps),
});

// ── The fingerprint ───────────────────────────────────────────────────────────

test('the same template hashes the same, whatever order the steps arrive in', () => {
  assert.equal(templateHash(CLEAN), templateHash([...CLEAN].reverse()));
});

test('any edit to the copy changes the hash', () => {
  const edited = [{ ...CLEAN[0], body: 'Hi {{first_name}}, a quick note. Pay $25,000.' }, CLEAN[1]];
  assert.notEqual(templateHash(CLEAN), templateHash(edited));
});

test('moving text between the subject and the body changes the hash', () => {
  // Concatenating the fields without a delimiter would make these two identical, and an
  // approval of one would silently carry to the other.
  const a = [{ position: 1, subject: 'Deadline', body: 'today' }];
  const b = [{ position: 1, subject: '', body: 'Deadlinetoday' }];
  assert.notEqual(templateHash(a), templateHash(b));
});

test('adding a step changes the hash', () => {
  assert.notEqual(templateHash(CLEAN), templateHash([...CLEAN, { position: 3, subject: '', body: 'One more.' }]));
});

// ── The states ────────────────────────────────────────────────────────────────

test('an unsigned clean template is honest about having no approval', () => {
  const f = fitness(none, CLEAN, lintSequence(CLEAN));
  assert.equal(f.fitToSend, false);
  assert.equal(f.blocked, false);
  assert.equal(f.copy.state, 'none');
  assert.equal(f.numbers.state, 'none');
  assert.equal(f.summary, 'Approval: none on record');
});

test('both sign-offs current and clean copy is fit to send', () => {
  const f = fitness(signedFor(CLEAN), CLEAN, lintSequence(CLEAN));
  assert.equal(f.fitToSend, true);
  assert.equal(f.summary, 'Approved and verified');
});

test('both sign-offs are required, because they are different competences', () => {
  // Well written and factually wrong is an easy thing for a template to be.
  const copyOnly = { ...signedFor(CLEAN), numbersVerifiedByEmail: null, numbersVerifiedAt: null, numbersVerifiedHash: null };
  const f = fitness(copyOnly, CLEAN, lintSequence(CLEAN));
  assert.equal(f.fitToSend, false);
  assert.equal(f.summary, 'Waiting on figure verification');
});

test('editing the copy after sign-off makes the approval stale, not valid', () => {
  // The whole reason the hash exists: approve on Monday, edit on Tuesday, and the tick
  // must not still be standing over text nobody has read.
  const edited = [{ ...CLEAN[0], body: 'Hi {{first_name}}. The penalty is $25,000.' }, CLEAN[1]];
  const f = fitness(signedFor(CLEAN), edited, lintSequence(edited));
  assert.equal(f.fitToSend, false);
  assert.equal(f.copy.state, 'stale');
  assert.equal(f.numbers.state, 'stale');
  assert.match(f.summary, /Template changed since/);
});

test('a stale sign-off still says who gave it and when', () => {
  const edited = [{ ...CLEAN[0], body: 'changed' }, CLEAN[1]];
  const f = fitness(signedFor(CLEAN), edited, lintSequence(edited));
  assert.equal(f.copy.state === 'stale' && f.copy.byEmail, 'shweta@usaindiacfo.com');
  assert.equal(f.copy.state === 'stale' && f.copy.at.toISOString(), AT.toISOString());
});

test('a placeholder in the copy outranks an approval', () => {
  // Approving a template does not resolve its placeholders, so the linter leads.
  const broken = [{ position: 1, subject: '{{Subject}}', body: 'Hi.' }];
  const f = fitness(signedFor(broken), broken, lintSequence(broken));
  assert.equal(f.blocked, true);
  assert.equal(f.fitToSend, false);
  assert.match(f.summary, /Not fit to send/);
});

test('a half-signed approval where the other half is stale reports the stale one', () => {
  const edited = [{ ...CLEAN[0], body: 'changed' }, CLEAN[1]];
  const half = { ...signedFor(CLEAN), numbersVerifiedByEmail: null, numbersVerifiedAt: null, numbersVerifiedHash: null };
  const f = fitness(half, edited, lintSequence(edited));
  assert.match(f.summary, /Template changed since copy approval/);
});

// ── Display ───────────────────────────────────────────────────────────────────

test('an unapproved sequence is not presented as plainly active', () => {
  // The app cannot stop Smartlead sending; what it can do is refuse to show an unchecked
  // campaign as though somebody had checked it.
  const f = fitness(none, CLEAN, lintSequence(CLEAN));
  assert.equal(displayStatus('active', f), 'active · unapproved');
});

test('an approved sequence shows the platform status unchanged', () => {
  const f = fitness(signedFor(CLEAN), CLEAN, lintSequence(CLEAN));
  assert.equal(displayStatus('active', f), 'active');
});

test('a sequence that is not sending is left alone either way', () => {
  const f = fitness(none, CLEAN, lintSequence(CLEAN));
  for (const s of ['draft', 'paused', 'archived']) assert.equal(displayStatus(s, f), s);
});

// ── Vocabulary ────────────────────────────────────────────────────────────────

test('every purpose has a label, and an unknown value renders as itself', () => {
  for (const p of SEQUENCE_PURPOSES) {
    assert.notEqual(purposeLabel(p), p, `${p} has no label`);
  }
  assert.equal(purposeLabel('something_else'), 'something_else');
  assert.equal(purposeLabel(null), null);
});

test('client_reminder exists, because the routing rule turns on it', () => {
  assert.ok(SEQUENCE_PURPOSES.includes('client_reminder'));
});
