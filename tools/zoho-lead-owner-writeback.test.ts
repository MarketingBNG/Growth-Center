import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zohoCrm } from '../lib/integrations/providers/zoho-crm.ts';
import { IntegrationError } from '../lib/integrations/types.ts';

// Reassigning a lead has to reach Zoho or it did not happen: the lead upsert writes
// `ownerEmail` from the vendor on every sync, so a local-only change is reverted at 01:30
// with nothing on screen saying so. These cover the write that closes that gap, and the
// two things about it that are easy to get wrong — Zoho names an owner by user id and
// never by address, and it answers 200 with per-record failures inside the body.

const CREDENTIAL = JSON.stringify({ refreshToken: 'test-refresh' });

type Call = { url: string; method?: string; body?: Record<string, unknown> };

/** Stubs the token and user endpoints; the PUT gets whatever the test says Zoho answers. */
async function withZoho(
  reply: { status: number; body: unknown },
  fn: () => Promise<unknown>,
  users: { id: string; email: string }[] = [
    { id: '77001', email: 'rikshita@usaindiacfo.com' },
    { id: '77002', email: 'vidhi.sondagar@usaindiacfo.com' },
  ],
) {
  const real = globalThis.fetch;
  const seen: Call[] = [];
  let result: unknown;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

    if (url.includes('/oauth/v2/token')) return json({ access_token: 'test-access' });
    if (url.includes('/crm/v6/users')) return json({ users });
    return json(reply.body, reply.status);
  }) as typeof fetch;

  try {
    result = await fn();
  } finally {
    globalThis.fetch = real;
  }
  return { seen, result };
}

const success = (n: number) => ({
  status: 200,
  body: { data: Array.from({ length: n }, () => ({ code: 'SUCCESS', status: 'success' })) },
});

test('an owner is written as a Zoho user id, never as an address', async () => {
  // The mistake this guards: Zoho rejects `Owner: "someone@..."` outright, so a rebalance
  // that looked correct in the preview would fail on every single record.
  const { seen } = await withZoho(success(1), () =>
    zohoCrm.updateLeadOwners!(CREDENTIAL, [
      { externalId: '9001', ownerEmail: 'rikshita@usaindiacfo.com' },
    ]),
  );

  const put = seen.find((c) => c.method === 'PUT');
  assert.ok(put, 'no update was sent');
  assert.match(put.url, /\/crm\/v6\/Leads$/);
  assert.deepEqual(put.body?.data, [{ id: '9001', Owner: { id: '77001' } }]);
});

test('workflows and assignment rules are suppressed on the write', async () => {
  // Zoho runs the org's own assignment rules on a write unless told not to. Left on, this
  // org's round-robin rule would reassign the lead again on arrival and silently undo the
  // rebalance — the hardest possible bug to see, because both systems report success.
  const { seen } = await withZoho(success(1), () =>
    zohoCrm.updateLeadOwners!(CREDENTIAL, [
      { externalId: '9001', ownerEmail: 'rikshita@usaindiacfo.com' },
    ]),
  );

  assert.deepEqual(seen.find((c) => c.method === 'PUT')?.body?.trigger, []);
});

test('an address Zoho does not know stops the run before anything is written', async () => {
  await assert.rejects(
    () =>
      withZoho(success(1), () =>
        zohoCrm.updateLeadOwners!(CREDENTIAL, [
          { externalId: '9001', ownerEmail: 'someone.who.left@usaindiacfo.com' },
        ]),
      ),
    (e: Error) => e instanceof IntegrationError && /no active user/.test(e.message),
  );
});

test('a partial refusal reports both halves instead of throwing', async () => {
  // The reason this returns rather than throws: a hundred-record batch can have one
  // rejection, and the other ninety-nine are already written in Zoho. Throwing would leave
  // the caller unable to tell which, so it would either revert good writes or trust bad ones.
  const { result } = await withZoho(
    {
      status: 200,
      body: {
        data: [
          { code: 'SUCCESS', status: 'success' },
          { code: 'INVALID_DATA', status: 'error', message: 'record is locked' },
        ],
      },
    },
    () =>
      zohoCrm.updateLeadOwners!(CREDENTIAL, [
        { externalId: '9001', ownerEmail: 'rikshita@usaindiacfo.com' },
        { externalId: '9002', ownerEmail: 'rikshita@usaindiacfo.com' },
      ]),
  );

  assert.deepEqual(result, {
    written: ['9001'],
    failed: [{ externalId: '9002', reason: 'record is locked' }],
  });
});

test('a connection authorised before the write scope says to reconnect', async () => {
  // Zoho fixes scope at authorisation, so every connection made before leads.UPDATE was
  // added rejects this call. The message has to name the fix or the button just says
  // something went wrong.
  await assert.rejects(
    () =>
      withZoho({ status: 202, body: { data: [{ code: 'OAUTH_SCOPE_MISMATCH', status: 'error' }] } }, () =>
        zohoCrm.updateLeadOwners!(CREDENTIAL, [
          { externalId: '9001', ownerEmail: 'rikshita@usaindiacfo.com' },
        ]),
      ),
    (e: Error) => /Reconnect Zoho CRM/.test(e.message),
  );
});

test('batches are capped at the hundred records Zoho accepts', async () => {
  const updates = Array.from({ length: 250 }, (_, i) => ({
    externalId: `lead-${i}`,
    ownerEmail: 'rikshita@usaindiacfo.com',
  }));
  const { seen, result } = await withZoho(success(100), () =>
    zohoCrm.updateLeadOwners!(CREDENTIAL, updates),
  );

  const puts = seen.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 3);
  assert.deepEqual(
    puts.map((p) => (p.body?.data as unknown[]).length),
    [100, 100, 50],
  );
  // The stub answers 100 successes to every chunk, so the last 50 come back with rows the
  // request did not ask about — those must not be counted as written leads.
  assert.equal((result as { written: string[] }).written.length, 250);
});

test('nothing is sent for an empty batch', async () => {
  const { seen, result } = await withZoho(success(0), () => zohoCrm.updateLeadOwners!(CREDENTIAL, []));

  assert.equal(seen.length, 0);
  assert.deepEqual(result, { written: [], failed: [] });
});
