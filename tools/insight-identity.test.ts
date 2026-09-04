import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ageInDays,
  ageLabel,
  fingerprint,
  normaliseSubject,
  toResolve,
} from '../lib/insight-identity.ts';

// ── normaliseSubject ──────────────────────────────────────────────────────────────────

test('a well-formed slug survives unchanged', () => {
  assert.equal(normaliseSubject('roas-below-one'), 'roas-below-one');
});

// The whole reason this function exists: the model is asked for a slug and does not
// always give one, and two spellings of the same subject must not become two findings.
test('spellings of one subject collapse to the same slug', () => {
  const forms = ['ROAS below one', 'roas_below_one', 'ROAS  below   one', ' Roas-Below-One '];
  for (const form of forms) {
    assert.equal(normaliseSubject(form), 'roas-below-one', form);
  }
});

test('punctuation does not leave trailing or doubled hyphens', () => {
  assert.equal(normaliseSubject('CAC ↑ 40% — why?'), 'cac-40-why');
  assert.equal(normaliseSubject('...leads...'), 'leads');
});

test('a long sentence is cut to something a later run can match', () => {
  const slug = normaliseSubject('a'.repeat(200));
  assert.ok(slug);
  assert.equal(slug.length, 80);
});

test('cutting never leaves a trailing hyphen', () => {
  // The 81st character is the hyphen, so a naive slice would end on one and the slug
  // would not equal the same subject truncated from a slightly different sentence.
  const slug = normaliseSubject(`${'a'.repeat(80)}-tail`);
  assert.equal(slug, 'a'.repeat(80));
});

test('nothing usable gives null, not an empty subject everything shares', () => {
  for (const input of ['', '   ', '---', '!!!', null, undefined]) {
    assert.equal(normaliseSubject(input), null, JSON.stringify(input));
  }
});

// ── fingerprint ───────────────────────────────────────────────────────────────────────

test('the same kind and subject give the same fingerprint', () => {
  assert.equal(fingerprint('risk', 'roas-below-one'), fingerprint('risk', 'ROAS below one'));
});

// One thing can be both a risk and an opportunity, and those are two findings.
test('the same subject under a different kind is a different finding', () => {
  assert.notEqual(fingerprint('risk', 'roas-below-one'), fingerprint('opportunity', 'roas-below-one'));
});

test('different subjects do not collide', () => {
  assert.notEqual(fingerprint('risk', 'roas-below-one'), fingerprint('risk', 'cac-rising'));
});

test('an unusable subject yields no fingerprint at all', () => {
  assert.equal(fingerprint('risk', '   '), null);
  assert.equal(fingerprint('risk', null), null);
});

// ── ageInDays / ageLabel ──────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

test('age counts whole days', () => {
  assert.equal(ageInDays(daysAgo(0), NOW), 0);
  assert.equal(ageInDays(daysAgo(1), NOW), 1);
  assert.equal(ageInDays(daysAgo(45), NOW), 45);
});

test('a first-seen date in the future does not read as negative age', () => {
  assert.equal(ageInDays(new Date(NOW.getTime() + 86_400_000), NOW), 0);
});

test('the label reads as a person would say it', () => {
  assert.equal(ageLabel(daysAgo(0), NOW), 'Raised today');
  assert.equal(ageLabel(daysAgo(1), NOW), 'Open since yesterday');
  assert.equal(ageLabel(daysAgo(12), NOW), 'Open 12 days');
});

// A row written before identity existed has no history, and calling it new would be the
// claim this module was built to stop making.
test('no history says nothing rather than guessing', () => {
  assert.equal(ageLabel(null, NOW), null);
  assert.equal(ageInDays(null, NOW), null);
});

// ── toResolve ─────────────────────────────────────────────────────────────────────────

const row = (id: string, fp: string | null, resolvedAt: Date | null = null) => ({
  id,
  fingerprint: fp,
  resolvedAt,
});

test('a finding this run did not report is resolved', () => {
  assert.deepEqual(toResolve([row('a', 'fp-a')], new Set(['fp-b'])), ['a']);
});

test('a finding this run reported again is left alone', () => {
  assert.deepEqual(toResolve([row('a', 'fp-a')], new Set(['fp-a'])), []);
});

test('a finding already resolved is not resolved twice', () => {
  assert.deepEqual(toResolve([row('a', 'fp-a', new Date())], new Set()), []);
});

// Untracked rows cannot be judged: there is no way to tell whether this run reported
// them, and stamping them resolved would assert something unknown.
test('a row with no fingerprint is never resolved', () => {
  assert.deepEqual(toResolve([row('a', null)], new Set(['fp-a'])), []);
});

test('only the unseen ones come back from a mixed set', () => {
  const stored = [row('a', 'fp-a'), row('b', 'fp-b'), row('c', null), row('d', 'fp-d', new Date())];
  assert.deepEqual(toResolve(stored, new Set(['fp-a'])), ['b']);
});
