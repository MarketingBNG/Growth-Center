import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRole } from '../lib/users.ts';

// The guards inside setRole(), which all run before it reaches the database. They matter
// more than they look: `role` is not enforced yet, so nothing today would notice a bad
// value — the damage would surface on the day tiers are switched on, by which time the
// wrong rows are long since written.
//
// These run with no DATABASE_URL, so anything that gets past a guard fails with
// "DATABASE_URL is not set". That is the signal the guard let it through, and the tests
// below use it deliberately rather than mocking Prisma.

const DB = /DATABASE_URL is not set/;

async function reason(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a throw, got none');
}

test('an admin account cannot be moved to a role that cannot manage settings', async () => {
  // The admin mailboxes are the guaranteed way back in. Leaving one as a viewer would,
  // once tiers are on, leave nobody able to put anyone right.
  for (const role of ['manager', 'member', 'viewer'] as const) {
    const msg = await reason(() => setRole('shweta@usaindiacfo.com', role));
    assert.match(msg, /must keep a role that can manage settings/, `${role} was allowed`);
  }
});

test('an admin account can still be moved between the two full-access roles', async () => {
  for (const role of ['partner', 'controller'] as const) {
    const msg = await reason(() => setRole('shweta@usaindiacfo.com', role));
    assert.match(msg, DB, `${role} was blocked by the admin guard`);
  }
});

test('the admin guard follows the address, not the spelling', async () => {
  // canonicalEmail folds bngadvisors.com onto the primary domain, so the second address
  // for the same mailbox has to hit the same guard.
  const msg = await reason(() => setRole('  Shweta@BngAdvisors.com ', 'viewer'));
  assert.match(msg, /must keep a role that can manage settings/);
});

test('a non-admin may hold any role', async () => {
  for (const role of ['partner', 'controller', 'manager', 'member', 'viewer'] as const) {
    const msg = await reason(() => setRole('gaurav@usaindiacfo.com', role));
    assert.match(msg, DB, `${role} was refused for an ordinary account`);
  }
});

test('an address outside the allowed domains is refused before anything else', async () => {
  const msg = await reason(() => setRole('someone@gmail.com', 'viewer'));
  assert.match(msg, /Not a valid company address/);
});

test('a value that is not a role is refused', async () => {
  // The API validates with zod first, but setRole is exported and must not trust callers.
  for (const bad of ['admin', 'approver', 'Partner', '']) {
    const msg = await reason(() => setRole('gaurav@usaindiacfo.com', bad as never));
    assert.match(msg, /Not a role/, `accepted ${JSON.stringify(bad)}`);
  }
});
