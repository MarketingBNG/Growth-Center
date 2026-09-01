import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zohoCrm } from '../lib/integrations/providers/zoho-crm.ts';
import { IntegrationError } from '../lib/integrations/types.ts';

// Ticking a task off in Growth Center used to write nothing back to Zoho, and the sync
// upserts `status` from the vendor's copy on every run — so the tick survived only until
// Zoho next touched that record. These cover the write that closes that gap.
//
// The two status words are this org's own, read off its Tasks picklist: "Completed" and
// "Not Started". Neither is a guess from the documentation, which is where the mapping
// bugs in this project have always come from.

const CREDENTIAL = JSON.stringify({ refreshToken: 'test-refresh' });

type Reply = { status: number; body: unknown };

/** Stubs the token endpoint and returns whatever the test says Zoho answers to the PUT. */
async function withZoho(reply: Reply, fn: () => Promise<void>) {
  const real = globalThis.fetch;
  const seen: { url: string; method?: string; body?: unknown }[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    if (url.includes('/oauth/v2/token')) {
      return new Response(JSON.stringify({ access_token: 'test-access' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

const ok = { status: 200, body: { data: [{ code: 'SUCCESS', status: 'success' }] } };

test('completing a task sends Zoho its own word for done', async () => {
  const seen = await withZoho(ok, () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true));

  const put = seen.find((c) => c.method === 'PUT');
  assert.ok(put, 'no update was sent');
  assert.match(put.url, /\/crm\/v6\/Tasks$/);
  assert.deepEqual(put.body, { data: [{ id: '4200', Status: 'Completed' }] });
});

test('reopening sends Not Started, which is what the CRM itself does', async () => {
  const seen = await withZoho(ok, () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', false));

  const put = seen.find((c) => c.method === 'PUT');
  assert.deepEqual(put?.body, { data: [{ id: '4200', Status: 'Not Started' }] });
});

test('a per-record refusal inside a 200 is still a failure', async () => {
  // Zoho answers 200 with the failure in the body. Reading only the HTTP status would
  // report a refused write as a success — and the local row would then disagree with the
  // CRM, which is the exact bug this write exists to prevent.
  await assert.rejects(
    () =>
      withZoho(
        { status: 200, body: { data: [{ code: 'MANDATORY_NOT_FOUND', status: 'error', message: 'required field missing' }] } },
        () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true),
      ),
    (e: Error) => e instanceof IntegrationError && /MANDATORY_NOT_FOUND/.test(e.message),
  );
});

test('a connection authorised before the write scope says to reconnect', async () => {
  // Zoho fixes scope at authorisation, so every connection made before tasks.UPDATE was
  // added rejects this call. The message has to name the fix, or the button just says
  // something went wrong.
  await assert.rejects(
    () =>
      withZoho(
        { status: 202, body: { data: [{ code: 'OAUTH_SCOPE_MISMATCH', status: 'error' }] } },
        () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true),
      ),
    (e: Error) => /Reconnect Zoho CRM/.test(e.message),
  );
});
