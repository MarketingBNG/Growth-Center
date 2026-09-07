import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zohoCrm } from '../lib/integrations/providers/zoho-crm.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// Every Zoho call starts by minting an access token from the stored refresh token, and
// that one request used to be the whole sync's single point of failure.
//
// What happened, from the live rows: on 2026-09-06 the nightly cron failed 797ms in with
// `Zoho: invalid_code`, the integration card carried that error for 23 hours, and then the
// same stored refresh token pulled 43,750 records on the first try when somebody pressed
// Sync now. The credential row had not been rewritten in between — so the token was never
// revoked and nothing needed reconnecting. Zoho answered badly once, and one bad answer
// cost a day of CRM data.
//
// These cover the retry that closes that, and the two things it must not do: retry
// forever, or retry an error that a second attempt cannot get past.

const CREDENTIAL = JSON.stringify({ refreshToken: 'test-refresh' });

type TokenReply = { status: number; body: unknown };

/**
 * Answers the token endpoint from a queue, one reply per call, and the write itself with
 * a success. Returns every URL the provider asked for, so a test can count the attempts.
 *
 * `seen` is the caller's array rather than one created here, because the tests that
 * matter most are the ones where `fn` throws — and a return value does not survive that.
 */
async function withTokenReplies(replies: TokenReply[], fn: () => Promise<void>, seen: string[] = []) {
  const real = globalThis.fetch;
  const queue = [...replies];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);

    if (url.includes('/oauth/v2/token')) {
      const reply = queue.shift();
      assert.ok(reply, `the provider asked for ${seen.length} tokens, and the test staged fewer`);
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: [{ code: 'SUCCESS', status: 'success' }] }), {
      status: 200,
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

const tokens = (urls: string[]) => urls.filter((u) => u.includes('/oauth/v2/token')).length;

const GOOD: TokenReply = { status: 200, body: { access_token: 'test-access' } };
const BLIP: TokenReply = { status: 200, body: { error: 'invalid_code' } };

test('a one-off invalid_code is retried rather than allowed to fail the run', async () => {
  const seen = await withTokenReplies([BLIP, GOOD], () =>
    zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true),
  );

  assert.equal(tokens(seen), 2, 'the second attempt is the whole point');
  assert.ok(
    seen.some((u) => u.includes('/crm/v6/Tasks')),
    'and the work goes ahead on the token the retry got',
  );
});

test('a refresh token that really is revoked still fails, saying so', async () => {
  await assert.rejects(
    () => withTokenReplies([BLIP, BLIP], () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true)),
    // Zoho's own word, kept: it is what tells somebody to reconnect the integration.
    /invalid_code/,
    'two attempts and no more — a retry loop would hide a revoked token behind a slow failure',
  );
});

test('bad client credentials are not retried, because the retry would send the same pair', async () => {
  const permanent: TokenReply = { status: 200, body: { error: 'invalid_client' } };
  const seen: string[] = [];

  await assert.rejects(
    () => withTokenReplies([permanent], () => zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true), seen),
    /invalid_client/,
  );

  assert.equal(tokens(seen), 1, 'a wrong client id is wrong on the second attempt too');
});

test('a 5xx from the token endpoint is retried too', async () => {
  const down: TokenReply = { status: 503, body: { error: 'service unavailable' } };
  const seen = await withTokenReplies([down, GOOD], () =>
    zohoCrm.updateTaskStatus!(CREDENTIAL, '4200', true),
  );

  assert.equal(tokens(seen), 2);
});

// A full pass over this org's CRM measured 182 seconds, inside a 300s function that has
// ten other providers to get through. It did not fit, and the way it failed was the worst
// available: the platform killed the function mid-provider, so neither branch of the
// try/catch in sync() ran, the row stayed on `syncing`, the card derived "Sync stalled",
// and the sync_run row went on claiming to be running.
//
// Asserted rather than left to a comment because the flag is invisible at the call site,
// and because a provider with `ownSchedule` and no cron entry silently never syncs at all.
test('Zoho CRM keeps its own schedule, and has a cron entry to run on', () => {
  assert.equal(zohoCrm.ownSchedule, true);
  assert.equal(getProvider('zoho_crm')?.id, 'zoho_crm', 'and is still registered, so the card renders');

  const { crons } = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as {
    crons: { path: string; schedule: string }[];
  };
  const entry = crons.find((c) => c.path === '/api/cron/zoho');
  assert.ok(entry, 'ownSchedule without a schedule is a provider that never runs');

  // Before the shared cron at 01:30, and before the packs at 02:30 and the digest at
  // 03:00 — both of which read this data.
  assert.equal(entry.schedule, '0 1 * * *');
});
