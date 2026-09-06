import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { PACKS, isFirstWorkingDay, isWeeklyDay, packsDue, renderPack } from '../lib/packs.ts';
import type { Report } from '../lib/reports.ts';

const utc = (iso: string) => new Date(`${iso}T02:30:00Z`);

// K7. Both reports have been buildable since §17; nothing sent them, so they were reports
// somebody had to remember to open.

test('the weekly pack goes out on a Monday and no other day', () => {
  assert.ok(isWeeklyDay(utc('2026-09-07')));
  for (const day of ['2026-09-06', '2026-09-08', '2026-09-12']) {
    assert.equal(isWeeklyDay(utc(day)), false, day);
  }
});

// ── the first working day ────────────────────────────────────────────────────────────
//
// "First working day" and "the 1st" are the same date eight months in twelve. The other
// four are the whole reason this is computed: a scorecard sent on Saturday the 1st is read
// on Monday the 3rd along with everything else.

test('a weekday 1st is the first working day', () => {
  // 1 Sep 2026 is a Tuesday.
  assert.ok(isFirstWorkingDay(utc('2026-09-01')));
});

test('when the 1st is a Saturday it is the 3rd', () => {
  // 1 Aug 2026 is a Saturday.
  assert.equal(isFirstWorkingDay(utc('2026-08-01')), false);
  assert.equal(isFirstWorkingDay(utc('2026-08-02')), false);
  assert.ok(isFirstWorkingDay(utc('2026-08-03')));
});

test('when the 1st is a Sunday it is the 2nd', () => {
  // 1 Nov 2026 is a Sunday.
  assert.equal(isFirstWorkingDay(utc('2026-11-01')), false);
  assert.ok(isFirstWorkingDay(utc('2026-11-02')));
});

// The 2nd and 3rd are only the first working day when the 1st was a weekend. Otherwise
// they are ordinary days and a monthly pack on one of them would be a second copy.
test('the 2nd and 3rd of an ordinary month are not pack days', () => {
  assert.equal(isFirstWorkingDay(utc('2026-09-02')), false);
  assert.equal(isFirstWorkingDay(utc('2026-09-03')), false);
});

test('no date past the 3rd can ever be a first working day', () => {
  for (const day of ['2026-09-04', '2026-09-15', '2026-09-30']) {
    assert.equal(isFirstWorkingDay(utc(day)), false, day);
  }
});

// ── both at once ─────────────────────────────────────────────────────────────────────

// A Monday that is also the first of the month is the day both readers expect something,
// and the route sends them independently so one failing does not take the other.
test('a Monday the 1st sends both packs', () => {
  // 1 Jun 2026 is a Monday.
  const due = packsDue(utc('2026-06-01'));
  assert.deepEqual(due.map((p) => p.id).sort(), ['monthly', 'weekly']);
});

test('most days send nothing', () => {
  assert.deepEqual(packsDue(utc('2026-09-16')), []);
});

// ── the message ──────────────────────────────────────────────────────────────────────

const report: Report = {
  id: 'weekly-pack',
  name: 'The weekly pack',
  range: { from: new Date('2026-09-01'), to: new Date('2026-09-07') },
  sections: [
    { kind: 'stats', title: 'Numbers', rows: [{ label: 'Leads', value: '12', hint: 'last 7 days' }] },
    { kind: 'table', title: 'Channels', columns: ['Channel', 'Leads'], rows: [['Meta', '8']] },
  ],
};

// The weekly pack's report is itself called "The weekly pack".
test('a pack does not say its own name twice', () => {
  const { subject } = renderPack(PACKS.weekly, report, 'https://example.com');
  assert.equal(subject, 'The weekly pack');
});

test('a pack whose report has its own name says both', () => {
  const exec = { ...report, name: 'Executive growth report' };
  assert.equal(
    renderPack(PACKS.monthly, exec, 'https://example.com').subject,
    'Monthly scorecard — Executive growth report',
  );
});

test('a stats row carries its hint, because the hint is what stops a misreading', () => {
  const { body } = renderPack(PACKS.weekly, report, 'https://example.com');
  assert.match(body, /Leads: 12 \(last 7 days\)/);
});

test('an empty table says so rather than rendering as a heading with nothing under it', () => {
  const empty: Report = { ...report, sections: [{ kind: 'table', title: 'Channels', columns: ['a'], rows: [] }] };
  assert.match(renderPack(PACKS.weekly, empty, 'https://example.com').body, /Nothing to report/);
});

test('the pack links back to the app, with or without a trailing slash', () => {
  for (const base of ['https://example.com', 'https://example.com/']) {
    const { body } = renderPack(PACKS.weekly, report, base);
    assert.match(body, /https:\/\/example\.com\/reports/);
    assert.doesNotMatch(body, /com\/\/reports/);
  }
});

// ── scheduling ───────────────────────────────────────────────────────────────────────

// 02:30 UTC is 08:00 IST, which is the hour §12.6 names — and at that hour the UTC
// calendar date and the IST one agree, which is what makes the UTC date arithmetic above
// land on the day the reader means.
test('the cron runs daily at the hour the packs are meant to arrive', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const packs = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/packs');
  assert.ok(packs, 'the packs cron must be scheduled');
  assert.equal(packs.schedule, '30 2 * * *');
});

// A pack that silently reaches nobody is indistinguishable from one that was never
// scheduled, which is the failure this file exists to fix.
test('the recipient list is never empty', () => {
  assert.match(readFileSync('lib/packs.ts', 'utf8'), /chosen\.length > 0 \? chosen\.map\(\(a\) => a\.email\) : ADMIN_EMAILS/);
});
