import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartlead } from '../lib/integrations/providers/smartlead.ts';

// Smartlead rate-limits this sync, and the way it used to react cost more than the pause
// did: a 429 threw, which failed the whole run, so a pass that had already walked
// thousands of prospects saved none of them and the Integrations page showed "0 rows"
// beside a red error.
//
// The cursor design already treats a partial pass as normal — that is how running out of
// time is handled. These check that a rate limit ends a pass the same way.

const CREDENTIAL = JSON.stringify({ apiKey: 'test-key' });

type Handler = (url: string) => { status: number; body?: unknown; headers?: Record<string, string> };

/** Swaps global fetch for the duration of one call. Restored in a finally, so a failing
 *  assertion cannot leak a stubbed fetch into the next test. */
async function withFetch<T>(handler: Handler, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++;
    const url = String(input);
    const { status, body = [], headers = {} } = handler(url);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof fetch;
  try {
    const out = await fn();
    return out;
  } finally {
    globalThis.fetch = real;
    void calls;
  }
}

const ctx = () => ({
  cursor: null,
  since: null,
  // Generous: these tests must fail on the rate-limit behaviour, not on the clock.
  deadline: Date.now() + 60_000,
  range: { from: new Date('2026-08-01'), to: new Date('2026-09-01') },
});

test('a rate limit ends the pass instead of failing the run', async () => {
  // The campaign list succeeds, so the pass has real rows in hand. Everything after it is
  // refused, which is the shape of a run that gets part-way and is then throttled.
  const slice = await withFetch(
    (url) =>
      url.includes('/campaigns/?') || url.endsWith('/campaigns/')
        ? { status: 200, body: [{ id: 1, name: 'Q3 outbound', status: 'ACTIVE', created_at: '2026-08-01' }] }
        : { status: 429 },
    () => smartlead.syncPaged!(CREDENTIAL, {}, ctx()),
  );

  assert.ok(slice.points.length > 0, 'the rows gathered before the limit must survive');
  assert.ok(
    slice.points.some((p) => p.entityType === 'outreach_sequence'),
    'the campaign it did fetch should be among them',
  );
});

test('a rate limit leaves a cursor to resume from', async () => {
  const slice = await withFetch(
    (url) =>
      url.includes('/campaigns/?') || url.endsWith('/campaigns/')
        ? { status: 200, body: [{ id: 1, name: 'Q3 outbound', status: 'ACTIVE', created_at: '2026-08-01' }] }
        : { status: 429 },
    () => smartlead.syncPaged!(CREDENTIAL, {}, ctx()),
  );

  // Not null. Null means "the pass finished", which would stamp the watermark and skip
  // everything the throttled run never reached.
  assert.notEqual(slice.cursor, null, 'a throttled pass is unfinished and must say so');
});

test('a 429 that clears is retried rather than surfaced', async () => {
  let refusals = 0;
  const slice = await withFetch(
    (url) => {
      if (url.includes('/campaigns/') && !url.includes('/analytics')) {
        // Refuse once, then answer. A transient 429 — another sync of the same workspace
        // overlapping — must not cost the run anything but the wait.
        if (refusals++ === 0) return { status: 429, headers: { 'retry-after': '0' } };
        return { status: 200, body: [{ id: 1, name: 'Q3', status: 'ACTIVE', created_at: '2026-08-01' }] };
      }
      return { status: 429 };
    },
    () => smartlead.syncPaged!(CREDENTIAL, {}, ctx()),
  );

  assert.ok(refusals > 1, 'the refused call should have been attempted again');
  assert.ok(
    slice.points.some((p) => p.entityType === 'outreach_sequence'),
    'the retry should have produced the campaign',
  );
});

test('requests are spaced, so the limit is not tripped in the first place', async () => {
  const at: number[] = [];
  await withFetch(
    (url) => {
      at.push(Date.now());
      return url.includes('/campaigns/') && !url.includes('/analytics')
        ? {
            status: 200,
            body: [
              { id: 1, name: 'A', status: 'ACTIVE', created_at: '2026-08-01' },
              { id: 2, name: 'B', status: 'ACTIVE', created_at: '2026-08-01' },
            ],
          }
        : { status: 429 };
    },
    () => smartlead.syncPaged!(CREDENTIAL, {}, ctx()),
  );

  assert.ok(at.length >= 2, `expected several requests, saw ${at.length}`);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  // 200ms rather than the 240ms the module paces at: the assertion is that pacing happens
  // at all, and pinning it to the exact constant makes this fail on a tuning change that
  // is still correct.
  assert.ok(
    gaps.every((g) => g >= 200),
    `requests should be spaced; gaps were ${gaps.join(', ')}ms`,
  );
});
