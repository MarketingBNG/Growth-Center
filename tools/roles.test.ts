import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAILS,
  ADMINS,
  ALLOWED_DOMAINS,
  PERMISSIONS,
  PRIMARY_DOMAIN,
  ROLES,
  ROLES_ENFORCED,
  ROLE_VALUES,
  can,
  canAdminister,
  canonicalEmail,
  initialsOf,
  isAdmin,
  isAllowedEmail,
  isRole,
  pinnedName,
  isFullAccess,
  nameFromEmail,
  roleLabel,
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

test('tiers are on, and can() now answers from POLICY', () => {
  assert.equal(ROLES_ENFORCED, true, 'update this file if tiers are switched off again');

  // The check that made flipping the flag safe, kept as a test rather than a memory: an
  // owner must still hold everything, because every account in this workspace is one and
  // switching enforcement on was required to change nothing on the day it happened.
  for (const permission of PERMISSIONS) {
    assert.equal(can('owner', permission), true, `owner was refused ${permission}`);
  }

  // And the tiers now actually bite, which is the whole point of the change.
  assert.equal(can('admin', 'settings:manage'), false);
  assert.equal(can('user', 'integrations:manage'), false);
  assert.equal(can('user', 'growth:read'), true);
});

// A permission POLICY does not define does not deny access — it reaches
// `POLICY[permission].includes` on undefined and throws, taking the route with it. Every
// string the application passes was checked against PERMISSIONS before enforcement was
// switched on; this keeps that true for the next one somebody adds.
test('every permission the app checks is defined in POLICY', () => {
  for (const permission of ['growth:read', 'integrations:manage', 'apikeys:manage', 'settings:manage', 'approve'] as const) {
    assert.ok(PERMISSIONS.includes(permission), `${permission} is used by the app and missing from POLICY`);
    assert.doesNotThrow(() => can('user', permission));
  }
});

test('can() still refuses someone with no role at all', () => {
  // requirePermission() leans on this for a signed-out or deactivated user.
  assert.equal(can(null, 'growth:read'), false);
  assert.equal(can(undefined, 'settings:manage'), false);
});

test('POLICY draws the lines the Team page promises', () => {
  assert.equal(wouldAllow('user', 'growth:read'), true);
  assert.equal(wouldAllow('user', 'crm:write'), true);
  assert.equal(wouldAllow('user', 'content:write'), true);
  assert.equal(wouldAllow('user', 'campaigns:write'), false);
  assert.equal(wouldAllow('user', 'outreach:send'), false);
  assert.equal(wouldAllow('admin', 'campaigns:write'), true);
  assert.equal(wouldAllow('admin', 'integrations:manage'), true);
  assert.equal(wouldAllow('admin', 'apikeys:manage'), false);
  assert.equal(wouldAllow('admin', 'settings:manage'), false);
  assert.equal(wouldAllow('owner', 'settings:manage'), true);
  assert.equal(wouldAllow('owner', 'apikeys:manage'), true);
});

test('only the owner can approve', () => {
  // Part V of the manual turns on this one line: an admin can build and run a campaign
  // and still not be the person who signs it off.
  assert.equal(wouldAllow('owner', 'approve'), true);
  assert.equal(wouldAllow('admin', 'approve'), false);
  assert.equal(wouldAllow('user', 'approve'), false);
  assert.deepEqual(ROLE_VALUES.filter((r) => wouldAllow(r, 'approve')), ['owner']);
});

test('isFullAccess now means owner, not merely signed in', () => {
  assert.equal(isFullAccess('owner'), true);
  assert.equal(isFullAccess('admin'), false);
  assert.equal(isFullAccess('user'), false);
  assert.equal(isFullAccess(null), false);
});

// ── The assignable role list ──────────────────────────────────────────────────

test('ROLES covers the Role union exactly, with no duplicates', () => {
  // The Team page and the settings API both drive off this list, and it has to stay in
  // step with the Role enum in prisma/schema.prisma — a value here that the database
  // does not know is a write that fails at the very last step.
  assert.deepEqual([...ROLE_VALUES].sort(), ['admin', 'owner', 'user']);
  assert.equal(new Set(ROLE_VALUES).size, ROLE_VALUES.length);
  for (const r of ROLES) assert.ok(r.label && r.blurb, `${r.value} is missing its copy`);
});

test('ROLES is ordered widest access first', () => {
  // The select reads top-to-bottom as a ladder, so the list has to actually be one.
  const breadth = ROLES.map((r) => PERMISSIONS.filter((p) => wouldAllow(r.value, p)).length);
  for (let i = 1; i < breadth.length; i++) {
    assert.ok(
      breadth[i] <= breadth[i - 1],
      `${ROLES[i].value} (${breadth[i]} permissions) is listed below ${ROLES[i - 1].value} (${breadth[i - 1]}) but holds more`,
    );
  }
  assert.equal(ROLES[0].value, 'owner');
  assert.equal(ROLES[ROLES.length - 1].value, 'user');
});

test('isRole rejects anything that is not a role', () => {
  assert.equal(isRole('owner'), true);
  assert.equal(isRole('user'), true);
  // The five tiers this replaced. A stale value must not sneak back through an old
  // client, a bookmarked request or a hand-written script.
  for (const gone of ['partner', 'controller', 'manager', 'member', 'viewer']) {
    assert.equal(isRole(gone), false, `${gone} is still accepted`);
  }
  assert.equal(isRole('Owner'), false);
  assert.equal(isRole(''), false);
  assert.equal(isRole(null), false);
  assert.equal(isRole(undefined), false);
});

test('roleLabel gives every role a display name', () => {
  assert.equal(roleLabel('owner'), 'Owner');
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('user'), 'User');
});

test('canAdminister names exactly the roles that can reach the Team page', () => {
  // The self-lockout and admin guards in lib/users.ts and the settings route both key
  // off this. It asks POLICY, not can(), so it stays true when tiers are switched on.
  assert.equal(canAdminister('owner'), true);
  assert.equal(canAdminister('admin'), false);
  assert.equal(canAdminister('user'), false);
});

test('at least one role can administer, or nobody could ever undo a change', () => {
  assert.ok(ROLE_VALUES.some(canAdminister));
});

// ── Admin ─────────────────────────────────────────────────────────────────────

test('every admin account is recognised', () => {
  assert.equal(isAdmin('marketing@usaindiacfo.com'), true);
  assert.equal(isAdmin('shweta@usaindiacfo.com'), true);
  assert.equal(isAdmin('akshay@usaindiacfo.com'), true);
  assert.equal(ADMIN_EMAILS.length, 3);
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
  assert.equal(pinnedName('akshay@usaindiacfo.com'), null);
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
