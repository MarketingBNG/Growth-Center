import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksSending, lintSequence, lintStep, summarise } from '../lib/outreach-lint.ts';

// Every fixture below is a real string from this workspace's 121 imported steps, or the
// shape of one. The token rules in particular were written from an inventory of what the
// templates actually contain rather than from Smartlead's documentation — the repeated
// lesson in this repo is that the vendor's vocabulary and the account's are different
// things.

const step = (over: Partial<{ position: number; subject: string | null; body: string }> = {}) => ({
  position: 1,
  subject: 'A subject',
  body: 'Hello there.',
  ...over,
});

const codes = (fs: { code: string }[]) => fs.map((f) => f.code).sort();

// ── Merge fields the platform really resolves ─────────────────────────────────

test('a genuine snake_case merge field is left alone', () => {
  // 29 steps use {{first_name}} and 22 use {{company_name}}. Flagging those would make
  // the linter useless on the first run.
  const found = lintStep(
    step({ subject: 'Hi {{first_name}}', body: 'About {{company_name}} and its filings.' }),
    true,
  );
  assert.deepEqual(found, []);
});

// ── Scaffolding: the certain findings ─────────────────────────────────────────

test('template scaffolding is critical, because nothing will ever fill it in', () => {
  // {{Body}} appears 9 times in live templates and {{Subject}} 8 times.
  for (const token of ['{{Subject}}', '{{Body}}', '{{Subject_Line}}', '{{Body_Line}}']) {
    const found = lintStep(step({ subject: token, body: 'text' }), true);
    assert.deepEqual(codes(found), ['scaffolding-token'], `${token} was not caught`);
    assert.equal(found[0].severity, 'critical');
    assert.ok(blocksSending(found), `${token} should block sending`);
  }
});

test('the misspelt scaffolding token in the live data is caught', () => {
  // {{Subejct}} is genuinely in one of the templates. A linter that only knew the correct
  // spelling would pass the one step most obviously written in a hurry.
  const found = lintStep(step({ subject: '{{Subejct}}' }), true);
  assert.deepEqual(codes(found), ['scaffolding-token']);
});

test('a token with a space in it is scaffolding, not a field', () => {
  // {{First Name}} (6x) and {{Company Name}} (3x) look like fields and are not — the
  // platform's fields have no spaces, so these send literally.
  for (const token of ['{{First Name}}', '{{Company Name}}', '{{Custom Field Name (1)}}']) {
    const found = lintStep(step({ body: token }), true);
    assert.deepEqual(codes(found), ['scaffolding-token'], `${token} was not caught`);
  }
});

test('an unusual token that might be a real custom field is raised for review, not blocked', () => {
  // {{State_List}} appears once. It could well be a defined custom field, so it is worth
  // a look and not worth stopping a campaign over.
  const found = lintStep(step({ body: 'Filing in {{State_List}} this quarter.' }), true);
  assert.deepEqual(codes(found), ['suspect-token']);
  assert.equal(found[0].severity, 'review');
  assert.equal(blocksSending(found), false);
});

// ── Placeholders ──────────────────────────────────────────────────────────────

test('bracketed placeholders are caught', () => {
  // All three of these are in the live templates.
  for (const text of ['[final date]', '[Company Name]', '[Link]']) {
    const found = lintStep(step({ body: `Due by ${text}.` }), true);
    assert.deepEqual(codes(found), ['placeholder'], `${text} was not caught`);
    assert.ok(blocksSending(found));
  }
});

test('a subject stored as the words for an empty one is caught', () => {
  // None today — what the audit saw was this app's own display fallback — but a template
  // copied out of a screenshot would carry it.
  assert.deepEqual(codes(lintStep(step({ subject: '(no subject)' }), true)), ['placeholder']);
  assert.deepEqual(codes(lintStep(step({ subject: 'No Subject' }), true)), ['placeholder']);
});

// ── Subjects ──────────────────────────────────────────────────────────────────

test('a blank subject is a defect on the opening email', () => {
  const found = lintStep(step({ subject: '' }), true);
  assert.deepEqual(codes(found), ['missing-subject']);
  assert.ok(blocksSending(found));
});

test('a blank subject on a follow-up is correct and must not be flagged', () => {
  // 37 of the 38 blank subjects in this workspace are follow-ups in the same thread.
  // Flagging them would bury the one that is real.
  assert.deepEqual(lintStep(step({ position: 2, subject: '' }), false), []);
  assert.deepEqual(lintStep(step({ position: 3, subject: null }), false), []);
});

// ── Figures ───────────────────────────────────────────────────────────────────

test('currency and percentage figures are raised for verification', () => {
  const found = lintStep(step({ body: 'The penalty is $25,000 and interest runs at 7.5%.' }), true);
  assert.deepEqual(codes(found), ['unverified-figure']);
  assert.equal(found[0].severity, 'review');
  assert.match(found[0].message, /\$25,000/);
  assert.match(found[0].message, /7\.5%/);
});

test('rupee and written currency figures are caught too', () => {
  // This firm quotes in both, and the Meta side of the workspace bills in rupees.
  for (const text of ['₹1,00,000', 'USD 10,000', 'Rs. 5,000', '£500']) {
    const found = lintStep(step({ body: `A charge of ${text} applies.` }), true);
    assert.deepEqual(codes(found), ['unverified-figure'], `${text} was not caught`);
  }
});

test('a figure is reported once however often it repeats', () => {
  const found = lintStep(step({ body: '$25,000 today, $25,000 tomorrow, $25,000 always.' }), true);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /a figure/);
});

test('ordinary numbers are not figures', () => {
  // Otherwise every date, list and street number in the corpus becomes a finding, and a
  // linter nobody can face reading is a linter nobody reads.
  assert.deepEqual(lintStep(step({ body: 'We have 3 offices and 12 staff. Form 5472.' }), true), []);
});

// ── HTML ──────────────────────────────────────────────────────────────────────

test('checks read the text, not the markup', () => {
  // 120 of the 121 imported steps are HTML, one of them 33KB of it. Linting the raw
  // markup would match attributes and miss nothing useful.
  const html = '<div style="width:600px"><p>Pay <strong>$25,000</strong> by [final date].</p></div>';
  const found = lintStep(step({ body: html }), true);
  assert.deepEqual(codes(found), ['placeholder', 'unverified-figure']);
  // width:600px must not read as a figure.
  assert.doesNotMatch(found.find((f) => f.code === 'unverified-figure')!.message, /600/);
});

test('an entity-encoded token is still caught', () => {
  const found = lintStep(step({ body: '<p>Hello {{Subject}}&nbsp;there</p>' }), true);
  assert.deepEqual(codes(found), ['scaffolding-token']);
});

// ── Whole sequences ───────────────────────────────────────────────────────────

test('the first step is the lowest position, not necessarily 1', () => {
  // Smartlead's positions start at 1 here, but the page already learned not to assume it,
  // and a sequence whose opening step was deleted would otherwise have no first step.
  const found = lintSequence([
    { position: 2, subject: '', body: 'opener' },
    { position: 3, subject: '', body: 'follow-up' },
  ]);
  assert.deepEqual(codes(found), ['missing-subject']);
  assert.equal(found[0].stepPosition, 2);
});

test('an empty sequence lints clean rather than throwing', () => {
  assert.deepEqual(lintSequence([]), []);
});

test('a summary counts each severity and blocking follows the criticals', () => {
  const findings = lintSequence([
    { position: 1, subject: '{{Subject}}', body: 'Pay $25,000 by [final date].' },
    { position: 2, subject: '', body: 'Hi {{first_name}}.' },
  ]);
  const s = summarise(findings);
  assert.equal(s.critical, 2, 'the scaffolding subject and the bracket are both critical');
  assert.equal(s.review, 1, 'the figure is for review');
  assert.ok(blocksSending(findings));
});

test('a clean sequence blocks nothing', () => {
  const findings = lintSequence([
    { position: 1, subject: 'Your US filing deadline', body: 'Hi {{first_name}}, a quick note.' },
    { position: 2, subject: '', body: 'Following up, {{first_name}}.' },
  ]);
  assert.deepEqual(findings, []);
  assert.equal(blocksSending(findings), false);
});
