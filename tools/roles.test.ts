import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, findUserByEmail, initialsOf, isFullAccess, ROSTER } from '../lib/roles.ts';

test('roster emails are unique and lowercase', () => {
  const seen = new Set<string>();
  for (const entry of ROSTER) {
    assert.equal(entry.email, entry.email.toLowerCase(), `${entry.email} is not lowercase`);
    assert.ok(!seen.has(entry.email), `${entry.email} appears twice`);
    seen.add(entry.email);
  }
});

test('findUserByEmail accepts a roster address', () => {
  const entry = findUserByEmail('shweta@usaindiacfo.com');
  assert.equal(entry?.name, 'Shweta Ramani');
  assert.equal(entry?.role, 'manager');
});

test('findUserByEmail is case and whitespace insensitive', () => {
  assert.equal(findUserByEmail('  Shweta@UsaIndiaCFO.com  ')?.name, 'Shweta Ramani');
});

test('findUserByEmail treats bngadvisors.com as the same person', () => {
  assert.equal(findUserByEmail('shweta@bngadvisors.com')?.name, 'Shweta Ramani');
});

test('findUserByEmail rejects an outside domain', () => {
  assert.equal(findUserByEmail('shweta@gmail.com'), null);
});

test('findUserByEmail rejects an unlisted local part on an allowed domain', () => {
  assert.equal(findUserByEmail('nobody@usaindiacfo.com'), null);
});

// This is the rule that once signed four non-roster accounts in as roster members in
// bng-command-center. It must never match on a prefix.
test('findUserByEmail does not prefix-match', () => {
  assert.equal(findUserByEmail('shweta.extra@usaindiacfo.com'), null);
  assert.equal(findUserByEmail('marketing2@usaindiacfo.com'), null);
});

test('findUserByEmail rejects malformed input', () => {
  for (const bad of ['', 'not-an-email', '@usaindiacfo.com', 'shweta@']) {
    assert.equal(findUserByEmail(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('permission policy: viewer reads but writes nothing', () => {
  assert.equal(can('viewer', 'growth:read'), true);
  assert.equal(can('viewer', 'crm:write'), false);
  assert.equal(can('viewer', 'integrations:manage'), false);
  assert.equal(can('viewer', 'settings:manage'), false);
});

test('permission policy: member writes CRM but does not manage integrations', () => {
  assert.equal(can('member', 'crm:write'), true);
  assert.equal(can('member', 'pipeline:write'), true);
  assert.equal(can('member', 'integrations:manage'), false);
  assert.equal(can('member', 'campaigns:write'), false);
});

test('permission policy: manager manages integrations but not API keys', () => {
  assert.equal(can('manager', 'integrations:manage'), true);
  assert.equal(can('manager', 'campaigns:write'), true);
  assert.equal(can('manager', 'apikeys:manage'), false);
  assert.equal(can('manager', 'settings:manage'), false);
});

test('permission policy: partner and controller have everything', () => {
  const all = [
    'growth:read', 'crm:write', 'pipeline:write', 'campaigns:write', 'content:write',
    'outreach:send', 'integrations:manage', 'apikeys:manage', 'ai:run', 'settings:manage',
  ] as const;
  for (const p of all) {
    assert.equal(can('partner', p), true, `partner denied ${p}`);
    assert.equal(can('controller', p), true, `controller denied ${p}`);
  }
});

test('no permission is granted to a null role', () => {
  assert.equal(can(null, 'growth:read'), false);
  assert.equal(can(undefined, 'crm:write'), false);
});

test('isFullAccess covers partner and controller only', () => {
  assert.equal(isFullAccess('partner'), true);
  assert.equal(isFullAccess('controller'), true);
  assert.equal(isFullAccess('manager'), false);
  assert.equal(isFullAccess(null), false);
});

test('initialsOf handles one and two word names', () => {
  assert.equal(initialsOf('Shweta Ramani'), 'SR');
  assert.equal(initialsOf('Karan'), 'KA');
  assert.equal(initialsOf('Lakshya Dadhich'), 'LD');
  assert.equal(initialsOf(''), '?');
});
