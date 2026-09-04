import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INSIGHT_STATUSES,
  STATUS_LABELS,
  canTransition,
  isInsightStatus,
  isOpen,
  nextStatuses,
  requirementFor,
} from '../lib/insight-lifecycle.ts';

// ── The state machine ─────────────────────────────────────────────────────────────────

test('every status has a label', () => {
  for (const s of INSIGHT_STATUSES) {
    assert.ok(STATUS_LABELS[s], s);
  }
});

test('the happy path runs end to end', () => {
  const path = ['proposed', 'reviewed', 'assigned', 'in_progress', 'done'] as const;
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`);
  }
});

// Closing a finding without ever owning it is how a queue gets cleared without the work
// happening — and §20.1's closure rate would then measure tidying, not progress.
test('nothing jumps straight from proposed to done', () => {
  assert.equal(canTransition('proposed', 'done'), false);
  assert.equal(canTransition('reviewed', 'done'), false);
});

test('a finding can be dismissed from any open state', () => {
  for (const s of INSIGHT_STATUSES) {
    if (!isOpen(s)) continue;
    assert.ok(canTransition(s, 'dismissed'), s);
  }
});

// A decision with no way back is one people avoid making.
test('a dismissal is reopenable', () => {
  assert.ok(canTransition('dismissed', 'proposed'));
});

test('done is terminal apart from reopening the work', () => {
  assert.deepEqual(nextStatuses('done'), ['assigned']);
  assert.equal(canTransition('done', 'dismissed'), false);
});

test('work can go back a step when it turns out to be someone else’s', () => {
  assert.ok(canTransition('in_progress', 'assigned'));
  assert.ok(canTransition('assigned', 'reviewed'));
});

test('no status can transition to itself', () => {
  for (const s of INSIGHT_STATUSES) {
    assert.equal(canTransition(s, s), false, s);
  }
});

test('every status can be left', () => {
  for (const s of INSIGHT_STATUSES) {
    assert.ok(nextStatuses(s).length > 0, s);
  }
});

test('open means somebody is meant to be doing it', () => {
  assert.equal(isOpen('proposed'), true);
  assert.equal(isOpen('in_progress'), true);
  assert.equal(isOpen('done'), false);
  assert.equal(isOpen('dismissed'), false);
});

test('isInsightStatus rejects anything else', () => {
  assert.equal(isInsightStatus('proposed'), true);
  for (const bad of ['Proposed', 'open', '', null, undefined, 7]) {
    assert.equal(isInsightStatus(bad), false, JSON.stringify(bad));
  }
});

// ── What a move requires ──────────────────────────────────────────────────────────────
//
// §20.1 rules out both halves of orphan work: an action with nobody carrying it, and
// commentary nobody ruled on.

test('assigning needs an owner', () => {
  assert.match(requirementFor('assigned', {}) ?? '', /needs an owner/);
  assert.equal(requirementFor('assigned', { ownerEmail: 'a@usaindiacfo.com' }), null);
});

test('dismissing needs a reason', () => {
  assert.match(requirementFor('dismissed', {}) ?? '', /needs a reason/);
  assert.equal(requirementFor('dismissed', { reviewNote: 'Already fixed in Zoho.' }), null);
});

test('whitespace is not a reason', () => {
  assert.ok(requirementFor('dismissed', { reviewNote: '   ' }));
});

test('every other move asks for nothing extra', () => {
  for (const s of ['proposed', 'reviewed', 'in_progress', 'done'] as const) {
    assert.equal(requirementFor(s, {}), null, s);
  }
});
