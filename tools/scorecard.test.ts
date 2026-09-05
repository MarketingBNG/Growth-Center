import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('lib/scorecard.ts', 'utf8');

// §7.5 exists to "end the argument about whether lead quality or lead handling is the
// problem". A table of conversion rates without the quality of what each person was
// handed settles that argument in marketing's favour by omission — and on this data the
// two explanations genuinely separate: one owner touched 86% of their leads and converted
// 0.4%, another touched none and converted 1.9%.
test('the scorecard carries the quality of what each owner was given', () => {
  assert.match(source, /medianScore/);
  assert.match(source, /handed/);
});

// Excluding the untouched is what made the median response time look healthy while most
// leads had never been contacted at all. The tail is the measure, not the exception.
test('rates are against every lead received, not against the touched ones', () => {
  assert.match(source, /slaRate: rate\(row\.withinSla, row\.leads\)/);
  assert.match(source, /semiQualifiedRate: rate\(row\.semiQualified, row\.leads\)/);
  assert.match(source, /convertedRate: rate\(row\.converted, row\.leads\)/);
});

// A null scoreVersion carries the column's placeholder zero. Folding those in would
// report every owner as having been handed worthless leads.
test('unscored leads are left out of the median rather than counted as zero', () => {
  assert.match(source, /if \(lead\.scoreVersion !== null\) acc\.scores\.push/);
});

// Three screens must not disagree about what "contacted" means.
test('the scorecard counts the same outbound touch the other screens do', () => {
  assert.match(source, /type: \{ in: \[\.\.\.CONTACT_TYPES\] \}/);
});

// A scorecard sorted by conversion rate puts whoever received four leads and converted
// one at the top, which is not a fact about performance.
test('owners are ordered by volume, not by rate', () => {
  assert.match(source, /\.sort\(\(a, b\) => b\.leads - a\.leads\)/);
});

// An owner judged on conversions landing this month would be credited for work done in
// April and blamed for leads they have had three days.
test('leads are counted by when they arrived', () => {
  assert.match(source, /where: \{ createdAt: window \}/);
});

// §19.4 also asks for a per-task-type SLA — brief to design 48h, approval 24h, reply
// handling 4h. Neither Zoho CRM nor Zoho Projects sends a task type this app can read, so
// the code reports what the data supports and says so rather than inventing a
// classification to hang three thresholds off.
test('the missing task-type SLA is stated rather than faked', () => {
  assert.match(source, /needs a task type/);
  // The comment quotes the manual's three numbers, which is the point of it. What must
  // not exist is code that reads a task type — that would be three thresholds hung off a
  // classification nothing can supply, and every task would fall into whichever bucket
  // the fallback chose.
  assert.doesNotMatch(source, /taskType|task_type/, 'nothing reads a task type that is not sent');
  // The one SLA it does read is the lead SLA, which is a real stored threshold.
  assert.match(source, /thresholds\(\)\)\['leads\.slaHours'\]/);
});

test('task load reports overdue, ageing and the oldest item per owner', () => {
  assert.match(source, /overdue \+= 1/);
  assert.match(source, /ageing \+= 1/);
  assert.match(source, /oldestDays/);
});
