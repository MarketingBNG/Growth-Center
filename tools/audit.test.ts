import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRow, phraseAction, summariseDetail } from '../lib/audit.ts';

// The Activity log renders one row per audit_event, and these two functions are the whole
// of its reading. They are written to degrade rather than hide: an action or a detail
// shape nobody anticipated is exactly the row someone will be hunting for.

test('every action written in the app has a phrasing', async () => {
  // Keeps the log from filling with raw identifiers as new call sites are added. If this
  // fails, add the new action to PHRASING rather than deleting the case from here.
  const written = [
    'apikey.create',
    'apikey.revoke',
    'content.create',
    'content.status',
    'integration.configure',
    'integration.connect',
    'integration.disconnect',
    'settings.currency',
    'user.activate',
    'user.deactivate',
    'user.rename',
    'user.role',
  ];
  for (const action of written) {
    assert.notEqual(phraseAction(action), action, `${action} has no phrasing`);
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
