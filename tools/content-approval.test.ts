import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_LABELS,
  approvalState,
  canPublish,
  contentHash,
  reviewAgeHours,
} from '../lib/content-approval.ts';

const piece = {
  title: 'What the new 1099-K threshold means for founders',
  brief: 'Short explainer for the newsletter.',
  url: null,
  format: 'blog',
  channelSlug: 'organic-search',
};

const unapproved = {
  ...piece,
  approvedByEmail: null,
  approvedAt: null,
  approvedHash: null,
  returnedAt: null,
  returnedNote: null,
};

const approved = {
  ...unapproved,
  approvedByEmail: 'shweta@usaindiacfo.com',
  approvedAt: new Date('2026-09-01T10:00:00Z'),
  approvedHash: contentHash(piece),
};

// ── The hash ──────────────────────────────────────────────────────────────────────────

test('the same content hashes the same', () => {
  assert.equal(contentHash(piece), contentHash({ ...piece }));
});

test('editing any judged field changes the hash', () => {
  for (const field of ['title', 'brief', 'url', 'format', 'channelSlug'] as const) {
    const edited = { ...piece, [field]: 'something else' };
    assert.notEqual(contentHash(edited), contentHash(piece), field);
  }
});

// Moving text between fields must not hash the same, or "Foo" / "Bar" and "Foo Bar" / ""
// would be one approval covering both.
test('moving text from the title into the brief changes the hash', () => {
  const a = { ...piece, title: 'Threshold news', brief: 'for founders' };
  const b = { ...piece, title: 'Threshold news for founders', brief: '' };
  assert.notEqual(contentHash(a), contentHash(b));
});

// These move on their own — views tick up hourly — and an approval that expired every
// time somebody read the page would be worthless.
test('view and lead counts are not part of what was approved', () => {
  const busy = { ...piece, views: 9000, leadsGenerated: 40 } as typeof piece;
  assert.equal(contentHash(busy), contentHash(piece));
});

// ── The state ─────────────────────────────────────────────────────────────────────────

test('a piece nobody has ruled on is unapproved', () => {
  assert.equal(approvalState(unapproved).state, 'unapproved');
  assert.equal(canPublish(approvalState(unapproved)), false);
});

test('an approval on unchanged content stands', () => {
  const state = approvalState(approved);
  assert.equal(state.state, 'approved');
  assert.equal(canPublish(state), true);
});

// The reason the hash exists: without it, the name and timestamp would sit there
// vouching for words the approver never read.
test('an approval on edited content goes stale, and stale cannot publish', () => {
  const edited = { ...approved, title: 'A completely different headline' };
  const state = approvalState(edited);
  assert.equal(state.state, 'stale');
  assert.equal(canPublish(state), false);
});

test('a stale approval still says who approved it and when', () => {
  const state = approvalState({ ...approved, title: 'Rewritten' });
  assert.equal(state.state === 'stale' && state.by, 'shweta@usaindiacfo.com');
});

test('a returned piece reports the reason it came back', () => {
  const returned = {
    ...unapproved,
    returnedAt: new Date('2026-09-02T09:00:00Z'),
    returnedNote: 'The 1099-K figure needs a source.',
  };
  const state = approvalState(returned);
  assert.equal(state.state, 'returned');
  assert.equal(state.state === 'returned' && state.note, 'The 1099-K figure needs a source.');
  assert.equal(canPublish(state), false);
});

// An approval answers a return, so it must win over one left on the row.
test('an approval outranks an earlier return', () => {
  const both = { ...approved, returnedAt: new Date('2026-08-30T09:00:00Z'), returnedNote: 'old' };
  assert.equal(approvalState(both).state, 'approved');
});

test('every state has a label a reader can act on', () => {
  for (const [state, label] of Object.entries(APPROVAL_LABELS)) {
    assert.ok(label.length > 3, state);
    // Named for what it means, not for the mechanism — "hash mismatch" tells nobody the
    // piece needs approving again.
    assert.doesNotMatch(label.toLowerCase(), /hash/, state);
  }
});

// ── The clock ─────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-04T12:00:00Z');

test('review age is measured in hours from when it entered review', () => {
  assert.equal(reviewAgeHours(new Date('2026-09-04T00:00:00Z'), NOW), 12);
});

test('nothing in review has no age, rather than an age of zero', () => {
  assert.equal(reviewAgeHours(null, NOW), null);
});

// §21.2: a return "keeps the SLA clock running". The clock is reviewStartedAt, which a
// return does not touch — so a piece returned and resubmitted keeps its real age.
test('a future start does not read as a negative age', () => {
  assert.equal(reviewAgeHours(new Date('2026-09-05T00:00:00Z'), NOW), 0);
});
