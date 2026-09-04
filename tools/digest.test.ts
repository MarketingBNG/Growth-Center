import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOP_N,
  rankItems,
  renderDigest,
  worthSending,
  type Digest,
  type PendingFinding,
} from '../lib/digest.ts';

// §20.6's digest. The ranking is the product: the reader acts on the first item and skims
// the rest, so an item in the wrong place is an item that does not get done.

const NOW = new Date('2026-09-05T09:00:00Z');
const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

function finding(over: Partial<PendingFinding> & { id: string }): PendingFinding {
  return {
    title: `Finding ${over.id}`,
    severity: 'medium',
    section: 'dashboard',
    proposedAction: null,
    firstSeenAt: hoursBefore(1),
    createdAt: hoursBefore(1),
    ...over,
  };
}

test('severity decides the order', () => {
  const ranked = rankItems(
    [
      finding({ id: 'a', severity: 'medium' }),
      finding({ id: 'b', severity: 'critical' }),
      finding({ id: 'c', severity: 'info' }),
      finding({ id: 'd', severity: 'high' }),
    ],
    24,
    NOW,
  );
  assert.deepEqual(ranked.map((f) => f.id), ['b', 'd', 'a', 'c']);
});

test('age breaks a tie, longest waiting first', () => {
  const ranked = rankItems(
    [
      finding({ id: 'new', severity: 'high', firstSeenAt: hoursBefore(2) }),
      finding({ id: 'old', severity: 'high', firstSeenAt: hoursBefore(200) }),
    ],
    24,
    NOW,
  );
  assert.deepEqual(ranked.map((f) => f.id), ['old', 'new']);
});

// The whole reason identity was built. A finding raised in July and re-raised every night
// since has been waiting since July; createdAt on the current row says this morning.
test('age is measured from when the finding was first seen', () => {
  const [item] = rankItems(
    [finding({ id: 'a', firstSeenAt: hoursBefore(500), createdAt: hoursBefore(1) })],
    24,
    NOW,
  );
  assert.equal(item.ageHours, 500);
  assert.equal(item.overdue, true);
});

test('a finding with no first-seen date falls back to when it was created', () => {
  const [item] = rankItems([finding({ id: 'a', firstSeenAt: null, createdAt: hoursBefore(72) })], 24, NOW);
  assert.equal(item.ageHours, 72);
});

test('overdue is measured against the SLA it was given', () => {
  const [inside] = rankItems([finding({ id: 'a', firstSeenAt: hoursBefore(23) })], 24, NOW);
  const [outside] = rankItems([finding({ id: 'b', firstSeenAt: hoursBefore(25) })], 24, NOW);
  assert.equal(inside.overdue, false);
  assert.equal(outside.overdue, true);
});

// A clock skew or a row written a second in the future must not report a negative wait.
test('a finding from the future is not waiting a negative time', () => {
  const [item] = rankItems([finding({ id: 'a', firstSeenAt: hoursBefore(-5) })], 24, NOW);
  assert.equal(item.ageHours, 0);
  assert.equal(item.overdue, false);
});

test('an unknown severity sorts last rather than first', () => {
  const ranked = rankItems(
    [finding({ id: 'weird', severity: 'blocker' }), finding({ id: 'info', severity: 'info' })],
    24,
    NOW,
  );
  assert.deepEqual(ranked.map((f) => f.id), ['info', 'weird']);
});

test('a missing severity is treated as medium, not as unknown', () => {
  const [item] = rankItems([finding({ id: 'a', severity: null })], 24, NOW);
  assert.equal(item.severity, 'medium');
});

// ── The message ───────────────────────────────────────────────────────────────────────

const EMPTY_HEALTH = { metrics: [], open: 0 };

function digest(over: Partial<Digest> = {}): Digest {
  return {
    items: rankItems([finding({ id: 'a', severity: 'high' })], 24, NOW),
    others: 0,
    overdue: 0,
    health: EMPTY_HEALTH as Digest['health'],
    slaHours: 24,
    ...over,
  };
}

// Nothing waiting means no email. A digest that lands every morning saying "nothing needs
// you" trains its reader to delete it unread.
test('an empty digest is not worth sending', () => {
  assert.equal(worthSending(digest({ items: [] })), false);
  assert.equal(worthSending(digest()), true);
});

test('a single finding is named in the subject', () => {
  const { subject } = renderDigest(digest(), 'https://x.test');
  assert.match(subject, /one finding needs a decision: Finding a/);
});

// The count in the subject has to include the ones the message did not list, or the
// subject and the body disagree about how much is waiting.
test('the subject counts everything waiting, not just what is listed', () => {
  const { subject } = renderDigest(digest({ others: 24 }), 'https://x.test');
  assert.match(subject, /25 findings need a decision/);
});

test('the overdue count leads the message when there is one', () => {
  const { body } = renderDigest(digest({ overdue: 3 }), 'https://x.test');
  assert.match(body.split('\n')[0], /3 of these have been waiting longer than the 24-hour/);
});

test('nothing about the SLA is said when nothing is overdue', () => {
  const { body } = renderDigest(digest(), 'https://x.test');
  assert.ok(!body.includes('decision SLA'));
});

test('the unlisted remainder is counted, not dropped', () => {
  const { body } = renderDigest(digest({ others: 24 }), 'https://x.test');
  assert.match(body, /And 24 more waiting on a decision/);
});

test('the message links to the page that holds all of it', () => {
  const { body } = renderDigest(digest(), 'https://growth.test');
  assert.match(body, /Decide on these: https:\/\/growth\.test\/ai/);
});

// A figure that could not be computed must not appear as a zero. §21.6's deferral rate is
// deliberately unmeasured, and a 0% there would sound an alarm for the wrong reason.
test('an unmeasurable health figure is left out rather than shown as zero', () => {
  const health = {
    open: 4,
    metrics: [
      { key: 'a', label: 'Measured', value: 40, format: 'percent' as const, healthy: '', drift: '' },
      { key: 'b', label: 'Not measured', value: null, format: 'percent' as const, healthy: '', drift: '' },
    ],
  };
  const { body } = renderDigest(digest({ health: health as Digest['health'] }), 'https://x.test');
  assert.match(body, /Measured: 40%/);
  assert.ok(!body.includes('Not measured'));
});

// Findings first, process metrics after. Putting the rates above would make the reader
// scroll past a process metric to reach the thing that needs them.
test('the findings come before the health numbers', () => {
  const health = {
    open: 1,
    metrics: [{ key: 'a', label: 'Closure rate', value: 50, format: 'percent' as const, healthy: '', drift: '' }],
  };
  const { body } = renderDigest(digest({ health: health as Digest['health'] }), 'https://x.test');
  assert.ok(body.indexOf('Finding a') < body.indexOf('Closure rate'));
});

test('a long wait is said in days rather than hours', () => {
  const items = rankItems([finding({ id: 'a', firstSeenAt: hoursBefore(240) })], 24, NOW);
  const { body } = renderDigest(digest({ items, overdue: 1 }), 'https://x.test');
  assert.match(body, /waiting 10d/);
});

test('the message says why silence is not a failure', () => {
  const { body } = renderDigest(digest(), 'https://x.test');
  assert.match(body, /sent only when something is waiting/);
});

test('five is the listed maximum', () => {
  assert.equal(TOP_N, 5);
});
