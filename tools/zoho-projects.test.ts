import { test } from 'node:test';
import assert from 'node:assert/strict';
import { owners, readCursor, taskPriority, taskStatus, zohoProjects } from '../lib/integrations/providers/zoho-projects.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// Values taken from the live portal (bngadvisorsprivateltd, 521 tasks across two
// projects), not from Zoho's documentation. Mapping against the vendor's vocabulary
// instead of this account's real values is the single most repeated bug in this codebase.

test('a closed status is read from is_closed_type, never from its name', () => {
  assert.equal(taskStatus({ name: 'Completed', is_closed_type: true }), 'done');
  assert.equal(taskStatus({ name: 'Open', is_closed_type: false }), 'open');
  assert.equal(taskStatus({ name: 'In Progress', is_closed_type: false }), 'in_progress');

  // The reason the boolean is authoritative: a project layout can rename or add statuses,
  // and a name match would land every task under a new name in `open` — silently.
  assert.equal(taskStatus({ name: 'Signed off by client', is_closed_type: true }), 'done');
  assert.equal(taskStatus({ name: 'Completed', is_closed_type: false }), 'open', 'a name that merely reads finished is not');
});

test('an absent or malformed status is open rather than a crash', () => {
  assert.equal(taskStatus(undefined), 'open');
  assert.equal(taskStatus(null), 'open');
  assert.equal(taskStatus({}), 'open');
  // Zoho sends a boolean; a string "true" is not one and must not be treated as closed.
  assert.equal(taskStatus({ name: 'Done', is_closed_type: 'true' }), 'open');
});

// 65 of the first 100 tasks in this portal carry `none` — nobody set a priority, which is
// not the same fact as somebody choosing medium. Both land on `normal` because the schema
// has no fourth state, so the original is kept in metadata rather than thrown away.
test('priority maps the four values Projects actually offers', () => {
  assert.equal(taskPriority('high'), 'high');
  assert.equal(taskPriority('low'), 'low');
  assert.equal(taskPriority('medium'), 'normal');
  assert.equal(taskPriority('none'), 'normal');
  assert.equal(taskPriority(undefined), 'normal');

  // `urgent` exists for the CRM's "Highest" and is unreachable from Projects. Mapping
  // high to it would make a Projects task outrank a genuinely more urgent CRM one.
  assert.notEqual(taskPriority('high'), 'urgent');
});

test('several owners keep the first and do not lose the rest', () => {
  const task = {
    owners_and_work: {
      owners: [
        { email: 'lakshya@usaindiacfo.com', name: 'Lakshya Dadhich' },
        { email: 'shweta@usaindiacfo.com', name: 'Shweta' },
      ],
    },
  };
  assert.deepEqual(owners(task), {
    assignee: 'lakshya@usaindiacfo.com',
    all: ['lakshya@usaindiacfo.com', 'shweta@usaindiacfo.com'],
  });
});

test('an unowned task yields null rather than an empty string', () => {
  assert.deepEqual(owners({}), { assignee: null, all: [] });
  assert.deepEqual(owners({ owners_and_work: { owners: [] } }), { assignee: null, all: [] });
  // An owner Zoho returns without an address must not become the string "undefined".
  assert.deepEqual(owners({ owners_and_work: { owners: [{ name: 'No address' }] } }), { assignee: null, all: [] });
});

test('a cursor survives a round trip and a damaged one is refused', () => {
  assert.deepEqual(readCursor({ portalId: '60037687374', page: 3 }), { portalId: '60037687374', page: 3 });

  assert.equal(readCursor(null), null);
  assert.equal(readCursor({ page: 2 }), null, 'without a portal there is nothing to resume');
  // Page 0 or a negative would re-fetch or skip a page of tasks.
  assert.equal(readCursor({ portalId: '1', page: 0 })?.page, 1);
  assert.equal(readCursor({ portalId: '1', page: 'x' })?.page, 1);
});

// Zoho fixes scope at authorisation. Adding Projects scopes to the CRM's client would
// force a CRM reconnect, and reconnecting the CRM revokes production's refresh token and
// stops the nightly sync. This is the assertion that keeps the two apart.
test('Projects uses its own OAuth client, never the CRM’s', () => {
  const names = zohoProjects.requiredEnv.map((e) => e.name);
  assert.deepEqual(names, ['ZOHO_PROJECTS_CLIENT_ID', 'ZOHO_PROJECTS_CLIENT_SECRET']);
  assert.ok(!names.includes('ZOHO_CLIENT_ID'), 'reusing the CRM client would revoke production’s token');
});

test('the portal id is digits, and anything else is refused at the form', () => {
  const normalise = zohoProjects.configFields?.find((f) => f.name === 'portalId')?.normalise;
  assert.ok(normalise);

  assert.equal(normalise('60037687374'), '60037687374');
  assert.equal(normalise('  60037687374 '), '60037687374');
  assert.equal(normalise(''), '', 'blank means "use the only portal there is"');
  // The two things somebody actually pastes when asked for a portal.
  assert.throws(() => normalise('bngadvisorsprivateltd'));
  assert.throws(() => normalise('https://projects.zoho.in/portal/bngadvisorsprivateltd'));
});

test('the provider is registered and asks for no write scope', () => {
  assert.equal(getProvider('zoho_projects')?.name, 'Zoho Projects');
  // §20.1: the agent cannot act on the world. Enforced at the grant, not in app code.
  assert.equal(zohoProjects.updateTaskStatus, undefined, 'reading only — writing back needs its own consent');
});

// Projects and the CRM share lib/integrations/providers/oauth.ts's zohoAccessToken, and
// the CRM's own retry (tools/zoho-token-retry.test.ts) was written after a one-off bad
// answer from Zoho cost a day of CRM syncing. Projects used to have no retry of its own;
// this is the same coverage, through Projects' own entry point (it has no
// updateTaskStatus to call, so syncPaged is what actually mints a token).
test('a one-off bad answer from the token endpoint does not fail a Projects sync', async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  let tokenCalls = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);

    if (url.includes('/oauth/v2/token')) {
      tokenCalls++;
      if (tokenCalls === 1) {
        return new Response(JSON.stringify({ error: 'invalid_code' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ access_token: 'test-access' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // The one portal task page this test needs, empty and already complete.
    return new Response(JSON.stringify({ tasks: [], page_info: { has_next_page: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await zohoProjects.syncPaged!(
      JSON.stringify({ refreshToken: 'test-refresh' }),
      { portalId: '60037687374' },
      { cursor: null, since: null, deadline: Date.now() + 30_000, range: { from: new Date(), to: new Date() } },
    );
    assert.deepEqual(result.points, []);
    assert.equal(tokenCalls, 2, 'the second attempt is the whole point');
  } finally {
    globalThis.fetch = real;
  }
});
