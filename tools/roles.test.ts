import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAILS,
  ADMINS,
  ALLOWED_DOMAINS,
  PRIMARY_DOMAIN,
  ROLES_ENFORCED,
  can,
  canonicalEmail,
  initialsOf,
  isAdmin,
  isAllowedEmail,
  pinnedName,
  isFullAccess,
  nameFromEmail,
  wouldAllow,
} from '../lib/roles.ts';

// ── Who may sign in ───────────────────────────────────────────────────────────
// The domain is the entire gate now. There is no roster to be absent from.

test('canonicalEmail accepts an address on the primary domain', () => {
  assert.equal(canonicalEmail('shweta@usaindiacfo.com'), 'shweta@usaindiacfo.com');
});

test('canonicalEmail is case and whitespace insensitive', () => {
  assert.equal(canonicalEmail('  Shweta@UsaIndiaCFO.com  '), 'shweta@usaindiacfo.com');
});

test('canonicalEmail folds the second domain onto the primary', () => {
  // Both addresses must resolve to one app_user row, or the same person ends up with
  // two accounts and half their owned records point at the wrong one.
  assert.equal(canonicalEmail('shweta@bngadvisors.com'), 'shweta@usaindiacfo.com');
  assert.ok(ALLOWED_DOMAINS.includes('bngadvisors.com'));
  assert.equal(PRIMARY_DOMAIN, 'usaindiacfo.com');
});

test('canonicalEmail rejects an outside domain', () => {
  assert.equal(canonicalEmail('someone@gmail.com'), null);
  assert.equal(canonicalEmail('someone@usaindiacfo.com.evil.net'), null);
});

test('canonicalEmail keeps the whole local part', () => {
  // The rule that once signed four wrong accounts in inside bng-command-center: a
  // longer local part must never collapse onto a shorter one.
  assert.equal(canonicalEmail('shweta.extra@usaindiacfo.com'), 'shweta.extra@usaindiacfo.com');
  assert.notEqual(canonicalEmail('marketing2@usaindiacfo.com'), 'marketing@usaindiacfo.com');
});

test('canonicalEmail rejects malformed input', () => {
  for (const bad of ['', 'not-an-email', '@usaindiacfo.com', 'shweta@', 'a@b@usaindiacfo.com']) {
    assert.equal(canonicalEmail(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('isAllowedEmail agrees with canonicalEmail', () => {
  assert.equal(isAllowedEmail('anyone@usaindiacfo.com'), true);
  assert.equal(isAllowedEmail('anyone@gmail.com'), false);
});

// ── Permissions ───────────────────────────────────────────────────────────────

test('tiers are off: every role holds every permission', () => {
  assert.equal(ROLES_ENFORCED, false, 'update this file when tiers are switched back on');
  for (const role of ['partner', 'controller', 'manager', 'member', 'viewer'] as const) {
    assert.equal(can(role, 'settings:manage'), true, `${role} was refused settings:manage`);
    assert.equal(can(role, 'apikeys:manage'), true, `${role} was refused apikeys:manage`);
    assert.equal(can(role, 'crm:write'), true, `${role} was refused crm:write`);
  }
});

test('can() still refuses someone with no role at all', () => {
  // requirePermission() leans on this for a signed-out or deactivated user.
  assert.equal(can(null, 'growth:read'), false);
  assert.equal(can(undefined, 'settings:manage'), false);
});

test('POLICY is intact underneath, ready to re-enable', () => {
  assert.equal(wouldAllow('viewer', 'growth:read'), true);
  assert.equal(wouldAllow('viewer', 'crm:write'), false);
  assert.equal(wouldAllow('member', 'crm:write'), true);
  assert.equal(wouldAllow('member', 'integrations:manage'), false);
  assert.equal(wouldAllow('manager', 'integrations:manage'), true);
  assert.equal(wouldAllow('manager', 'apikeys:manage'), false);
  assert.equal(wouldAllow('partner', 'settings:manage'), true);
  assert.equal(wouldAllow('controller', 'settings:manage'), true);
});

test('isFullAccess is true for anyone signed in while tiers are off', () => {
  assert.equal(isFullAccess('viewer'), true);
  assert.equal(isFullAccess(null), false);
});

// ── Admin ─────────────────────────────────────────────────────────────────────

test('both admin accounts are recognised', () => {
  assert.equal(isAdmin('marketing@usaindiacfo.com'), true);
  assert.equal(isAdmin('shweta@usaindiacfo.com'), true);
  assert.equal(ADMIN_EMAILS.length, 2);
});

test('isAdmin matches however the address is typed', () => {
  assert.equal(isAdmin('  Marketing@UsaIndiaCFO.com  '), true);
  // The same mailbox on the second domain is the same account.
  assert.equal(isAdmin('shweta@bngadvisors.com'), true);
});

test('isAdmin does not match a lookalike address', () => {
  assert.equal(isAdmin('marketing2@usaindiacfo.com'), false);
  assert.equal(isAdmin('shweta.extra@usaindiacfo.com'), false);
  assert.equal(isAdmin('marketing@gmail.com'), false);
  assert.equal(isAdmin(''), false);
  assert.equal(isAdmin(null), false);
});

test('every admin address is a valid, already-canonical company address', () => {
  for (const email of ADMIN_EMAILS) {
    assert.equal(canonicalEmail(email), email, `${email} is not in canonical form`);
  }
});

test('only the shared mailbox has its name pinned', () => {
  // A pinned name is re-asserted on every sign-in, so pinning a real person's would
  // make the Team page's Rename button silently useless for them.
  assert.equal(pinnedName('marketing@usaindiacfo.com'), 'Marketing');
  assert.equal(pinnedName('shweta@usaindiacfo.com'), null);
  assert.equal(pinnedName('anyone@usaindiacfo.com'), null);
  assert.equal(ADMINS.filter((a) => a.name).length, 1);
});

// ── Display helpers ───────────────────────────────────────────────────────────

test('initialsOf', () => {
  assert.equal(initialsOf('Shweta Ramani'), 'SR');
  assert.equal(initialsOf('Karan'), 'KA');
  assert.equal(initialsOf('  Nidhi   Jain  '), 'NJ');
  assert.equal(initialsOf(''), '?');
});

test('nameFromEmail is a readable fallback when Google sends no name', () => {
  assert.equal(nameFromEmail('nidhi.jain@usaindiacfo.com'), 'Nidhi Jain');
  assert.equal(nameFromEmail('marketing@usaindiacfo.com'), 'Marketing');
});
