import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { splitByRoster } from '../lib/roster.ts';

// D2. The task-debt rule raised one finding per person across the whole firm — eighteen
// above the floor, of whom one was on the marketing team. Raising the threshold does not
// help: a floor of 99,999 still produced fifteen findings, because the debt is that large.

type Row = { assigneeEmail: string | null };
const rows: Row[] = [
  { assigneeEmail: 'tanisha@usaindiacfo.com' },
  { assigneeEmail: 'sanchit@usaindiacfo.com' },
  { assigneeEmail: null },
];
const emailOf = (r: Row) => r.assigneeEmail;

test('the roster decides whose debt is this team’s business', () => {
  const { mine, rest } = splitByRoster(rows, emailOf, ['tanisha@usaindiacfo.com']);
  assert.deepEqual(mine.map(emailOf), ['tanisha@usaindiacfo.com']);
  assert.deepEqual(rest.map(emailOf), ['sanchit@usaindiacfo.com', null]);
});

// The list is typed by a person and compared against addresses that arrived from Zoho.
// A roster that silently matches nothing looks exactly like one that was never saved.
test('a differently-spelled address still matches', () => {
  const { mine } = splitByRoster(
    [{ assigneeEmail: 'Tanisha@UsaIndiaCFO.com' }],
    emailOf,
    ['tanisha@usaindiacfo.com'],
  );
  assert.equal(mine.length, 1);
});

test('an unassigned row is never somebody’s debt', () => {
  const { mine } = splitByRoster([{ assigneeEmail: null }], emailOf, ['tanisha@usaindiacfo.com']);
  assert.equal(mine.length, 0);
});

// The important one. Scoping to an empty list would delete a true finding, and a queue
// going quiet because a setting is unset is the worst way for this to fail.
test('an empty roster leaves everyone outside it, so nothing is silently dropped', () => {
  const { mine, rest } = splitByRoster(rows, emailOf, []);
  assert.equal(mine.length, 0);
  assert.equal(rest.length, 3);
});

// ── how the rule uses it ─────────────────────────────────────────────────────────────

const rules = readFileSync('lib/insight-rules.ts', 'utf8');

test('an unset roster raises a configuration finding rather than going quiet', () => {
  assert.match(rules, /subject: 'marketing-roster-unset'/);
  assert.match(rules, /if \(roster\.length === 0\)/);
});

// The firm's debt is real and somebody should see it — it is simply not this team's
// queue, and seventeen items nobody here can work is how a queue gets abandoned.
test('everybody outside the roster is summarised as one item, not seventeen', () => {
  assert.match(rules, /subject: 'firm-task-debt-outside-marketing'/);
  assert.match(rules, /largestHolder/);
});

test('a change to the roster is recorded, like a threshold change', () => {
  const route = readFileSync('app/api/settings/roster/route.ts', 'utf8');
  assert.match(route, /action: 'settings\.roster'/);
  assert.match(route, /detail: \{ from: before, to: unique \}/);
});
