import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRow, phraseAction, summariseDetail } from '../lib/audit.ts';

// The Activity log renders one row per audit_event, and these two functions are the whole
// of its reading. They are written to degrade rather than hide: an action or a detail
// shape nobody anticipated is exactly the row someone will be hunting for.

test('every action written in the app has a phrasing', () => {
  // The compiler already enforces this — PHRASING is a total map over AuditAction — so
  // this is here for the half it cannot check: that a sentence is a SENTENCE and not the
  // identifier copied across, which would satisfy the type and still print
  // "duplicate.merged" in a column of English.
  //
  // Ten of these were unphrased for months. Nothing failed; the log simply printed raw
  // identifiers, which reads as a bug in the page rather than a gap in a map.
  const written = [
    'apikey.create',
    'apikey.revoke',
    'budget.envelope',
    'capacity.set',
    'content.approve',
    'content.calendar_import',
    'content.calendar_replace',
    'content.create',
    'content.return',
    'content.status',
    'content.update',
    'duplicate.dismissed',
    'duplicate.merge_undone',
    'duplicate.merged',
    'insight.status',
    'integration.configure',
    'integration.connect',
    'integration.disconnect',
    'leads.rebalance',
    'sequence.registry',
    'sequence.copy_signed',
    'sequence.copy_withdrawn',
    'sequence.numbers_signed',
    'sequence.numbers_withdrawn',
    'settings.currency',
    'settings.glossary',
    'settings.insight_owner',
    'settings.roster',
    'settings.threshold',
    'user.activate',
    'user.deactivate',
    'user.rename',
    'user.role',
  ];

  for (const action of written) {
    const phrase = phraseAction(action);
    assert.notEqual(phrase, action, `${action} has no phrasing`);
    // A sentence reads as one: lower case, spaced, and carrying none of the dotted
    // identifier it replaces.
    assert.match(phrase, /^[a-z][a-z '’-]* /, `${action} is phrased as "${phrase}"`);
    assert.doesNotMatch(phrase, /\./, `${action} is phrased as "${phrase}"`);
  }
});

test('a withdrawn sign-off does not read like a granted one', () => {
  // These four are the only actions built from a variable at their call site, and the
  // pair that matters most is the one the log is opened to settle: whether the copy was
  // signed off or the sign-off was taken back.
  for (const kind of ['copy', 'numbers']) {
    const signed = phraseAction(`sequence.${kind}_signed`);
    const withdrawn = phraseAction(`sequence.${kind}_withdrawn`);
    assert.notEqual(signed, withdrawn);
    assert.match(withdrawn, /withdrew/);
  }
});

test('an unknown action falls back to its own name, never to nothing', () => {
  // A log that silently drops what it does not recognise is worse than no log.
  assert.equal(phraseAction('something.new'), 'something.new');
  assert.equal(phraseAction(''), '');
});

test('a from/to detail reads as a transition', () => {
  assert.equal(
    summariseDetail({ title: 'DTAA explainer', from: 'draft', to: 'published' }),
    'DTAA explainer · draft → published',
  );
  assert.equal(
    summariseDetail({ email: 'gaurav@usaindiacfo.com', role: 'admin' }),
    'gaurav@usaindiacfo.com · admin',
  );
});

test('a half-present transition still renders both sides', () => {
  assert.equal(summariseDetail({ from: 'idea' }), 'idea → —');
  assert.equal(summariseDetail({ to: 'published' }), '— → published');
});

test('a detail with no recognised key names its keys rather than going blank', () => {
  assert.equal(summariseDetail({ somethingNew: 1, another: 2 }), 'somethingNew, another');
});

test('a missing or unusable detail renders as empty, not as a crash', () => {
  for (const bad of [null, undefined, 'a string', 42, [], {}]) {
    assert.equal(summariseDetail(bad), '', `threw or mis-rendered on ${JSON.stringify(bad)}`);
  }
});

test('a nested object in from/to does not print [object Object]', () => {
  // detail is Json, so a call site can put anything in there.
  assert.equal(summariseDetail({ from: { a: 1 }, to: { b: 2 } }), '— → —');
});

test('a row with no detail falls back to naming its subject', () => {
  // The integration rows are the bulk of the log and carry no detail; their entityId is
  // the provider slug, so this fallback is the only thing that says which one.
  assert.equal(describeRow({ detail: null, entityId: 'meta_ads' }), 'meta_ads');
  assert.equal(describeRow({ detail: {}, entityId: 'zoho_crm' }), 'zoho_crm');
});

test('a detail worth showing wins over the subject', () => {
  assert.equal(
    describeRow({ detail: { from: 'draft', to: 'published' }, entityId: 'abc123' }),
    'draft → published',
  );
});

test('a row with neither renders empty rather than throwing', () => {
  assert.equal(describeRow({ detail: null, entityId: null }), '');
});

// ── Record changes, merged in from the activity table ─────────────────────────────────
//
// The activity log reads both tables. Its phrasing map has to cover the `record.*`
// actions the merge synthesises, or every lead status change in the log reads as its own
// enum value.

test('every record action the merge can produce has a phrasing', () => {
  // The ActivityType values that carry an actorEmail — the ones a person causes. `created`
  // and `synced` come from the importer and are filtered out before they reach here.
  const byPeople = [
    'status_changed',
    'owner_changed',
    'note_added',
    'task_completed',
    'stage_changed',
    'converted',
  ];
  for (const type of byPeople) {
    const action = `record.${type}`;
    assert.notEqual(phraseAction(action), action, `${action} falls back to its own name`);
  }
});

// The prefix is what stops a synthesised action colliding with a real one — an activity
// of type `status_changed` and a settings action named `status_changed` would otherwise
// share a row in the phrasing map and one would silently win.
test('a record action reads differently from a settings action', () => {
  assert.notEqual(phraseAction('record.status_changed'), phraseAction('content.status'));
});

// ── Retired actions ───────────────────────────────────────────────────────────────────

test('an action nothing writes any more still reads as a sentence', () => {
  // insight.dismiss and insight.restore became the single insight.status, and a row of
  // each is still in the log. They were briefly dropped when the phrasing map was made
  // total over the actions the app can write — which made the two oldest rows the only
  // unreadable ones. A log is kept precisely so old rows stay legible.
  for (const action of ['insight.dismiss', 'insight.restore']) {
    assert.notEqual(phraseAction(action), action, `${action} lost its phrasing`);
  }
});
