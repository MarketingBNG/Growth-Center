import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_URLS_PER_REQUEST,
  assertValidKey,
  chunk,
  explainStatus,
  groupByHost,
  notifyIndexNow,
} from '../lib/integrations/indexnow.ts';

// IndexNow. The interesting failures here are all quiet ones: a key file that was never
// uploaded, a URL on the wrong host taking a whole batch down with it, a submission that
// reports success because nothing was sent.

test('the documented batch ceiling is what the code splits on', () => {
  assert.equal(MAX_URLS_PER_REQUEST, 10_000);
});

// ── the key ──────────────────────────────────────────────────────────────────────────

test('a key outside the published format is refused before anything is sent', () => {
  assert.throws(() => assertValidKey('short'), /8 to 128/);
  assert.throws(() => assertValidKey(''), /8 to 128/);
  assert.throws(() => assertValidKey('has spaces in it'), /8 to 128/);
  assert.throws(() => assertValidKey(`${'a'.repeat(129)}`), /8 to 128/);
});

test('the character set the documentation actually permits is accepted', () => {
  // The page says "hexadecimal" and then lists a-z, A-Z, 0-9 and dashes, which is not
  // hexadecimal. The stated set is what is enforced.
  assertValidKey('abcdef12');
  assertValidKey('A-Very-Long-Key-With-Dashes-0123456789');
  assertValidKey('z'.repeat(128));
});

// ── grouping ─────────────────────────────────────────────────────────────────────────

test('URLs are grouped by host, because a batch carries exactly one', () => {
  const { valid } = groupByHost([
    'https://usaindiacfo.com/a',
    'https://usaindiacfo.com/b',
    'https://blog.usaindiacfo.com/c',
  ]);
  assert.deepEqual([...valid.keys()].sort(), ['blog.usaindiacfo.com', 'usaindiacfo.com']);
  assert.equal(valid.get('usaindiacfo.com')?.length, 2);
});

// One stray URL would otherwise take the other nine hundred down with it: the whole batch
// comes back 422 and nothing in it is indexed.
test('a mixed list becomes one request per host rather than one failure', () => {
  const { valid } = groupByHost(['https://a.com/1', 'https://b.com/1']);
  assert.equal(valid.size, 2, 'sent as one batch this would be a 422 and nothing would index');
});

test('anything that is not an http page is rejected, not sent', () => {
  const { valid, rejected } = groupByHost([
    'mailto:someone@usaindiacfo.com',
    'javascript:alert(1)',
    'not a url at all',
    'https://usaindiacfo.com/real',
  ]);
  assert.deepEqual([...valid.keys()], ['usaindiacfo.com']);
  assert.equal(rejected.length, 3);
});

test('the same URL twice in one list is submitted once', () => {
  const { valid } = groupByHost(['https://a.com/x', 'https://a.com/x', ' https://a.com/x ']);
  assert.deepEqual(valid.get('a.com'), ['https://a.com/x']);
});

test('blank entries are skipped without being counted as rejects', () => {
  const { valid, rejected } = groupByHost(['', '   ', 'https://a.com/x']);
  assert.equal(rejected.length, 0);
  assert.equal(valid.get('a.com')?.length, 1);
});

// ── chunking ─────────────────────────────────────────────────────────────────────────

test('a list longer than the ceiling is split, and nothing is dropped', () => {
  const urls = Array.from({ length: 25 }, (_, i) => `https://a.com/${i}`);
  const batches = chunk(urls, 10);
  assert.deepEqual(batches.map((b) => b.length), [10, 10, 5]);
  assert.equal(batches.flat().length, 25);
});

test('a list inside the ceiling is one request', () => {
  assert.equal(chunk(['a', 'b'], 10).length, 1);
  assert.equal(chunk([]).length, 0);
});

// ── statuses ─────────────────────────────────────────────────────────────────────────

test('202 is success — the key is merely still being checked', () => {
  assert.equal(explainStatus(202).ok, true);
  assert.equal(explainStatus(200).ok, true);
});

test('the two failures worth naming say what to actually do', () => {
  assert.match(explainStatus(403).message, /key file is missing/i);
  assert.match(explainStatus(422).message, /do not all belong to the host/i);
  assert.equal(explainStatus(403).ok, false);
  assert.equal(explainStatus(422).ok, false);
});

test('an undocumented status is a failure rather than assumed fine', () => {
  assert.equal(explainStatus(500).ok, false);
  assert.match(explainStatus(500).message, /500/);
});

// ── the call ─────────────────────────────────────────────────────────────────────────

async function withStub<T>(
  respond: (body: Record<string, unknown>) => Response,
  run: () => Promise<T>,
) {
  const originalFetch = global.fetch;
  const originalKey = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = 'test-key-12345678';
  const sent: Record<string, unknown>[] = [];
  global.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    sent.push(body);
    return respond(body);
  }) as typeof fetch;
  let value: T;
  try {
    value = await run();
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalKey;
  }
  return { sent, value };
}

test('a refusal is reported, not thrown — it must not take down the publish that called it', async () => {
  const { value: result } = await withStub(
    () => new Response('', { status: 403 }),
    () => notifyIndexNow(['https://usaindiacfo.com/a']),
  );
  assert.equal(result.ok, false);
  assert.equal(result.submitted, 0);
  assert.equal(result.outcomes[0].status, 403);
  assert.match(result.outcomes[0].message, /key file is missing/i);
});

test('an unreachable endpoint is still an outcome, not a vanished call', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = 'test-key-12345678';
  global.fetch = (async () => {
    throw new Error('socket hang up');
  }) as typeof fetch;
  try {
    const result = await notifyIndexNow(['https://usaindiacfo.com/a']);
    assert.equal(result.outcomes.length, 1, 'the call must appear in the log either way');
    assert.equal(result.outcomes[0].status, 0);
    assert.equal(result.outcomes[0].ok, false);
    assert.match(result.outcomes[0].message, /socket hang up/);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalKey;
  }
});

test('the request carries the host, key and URL list the protocol asks for', async () => {
  const { sent } = await withStub(
    () => new Response('', { status: 200 }),
    async () => {
      const result = await notifyIndexNow(['https://usaindiacfo.com/a', 'https://usaindiacfo.com/b']);
      assert.equal(result.ok, true);
      assert.equal(result.submitted, 2);
    },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].host, 'usaindiacfo.com');
  assert.equal(sent[0].key, 'test-key-12345678');
  assert.deepEqual(sent[0].urlList, ['https://usaindiacfo.com/a', 'https://usaindiacfo.com/b']);
});

// Nothing sent is not success. Reporting ok here would make a publish that notified
// nobody read as a publish that notified everybody.
test('a call with nothing worth sending does not report success', async () => {
  await withStub(
    () => new Response('', { status: 200 }),
    async () => {
      const result = await notifyIndexNow(['mailto:x@y.com']);
      assert.equal(result.ok, false);
      assert.equal(result.submitted, 0);
      assert.equal(result.rejected.length, 1);
    },
  );
});

test('two hosts are two requests', async () => {
  const { sent } = await withStub(
    () => new Response('', { status: 200 }),
    async () => {
      const result = await notifyIndexNow(['https://a.com/1', 'https://b.com/1']);
      assert.equal(result.outcomes.length, 2);
      assert.equal(result.submitted, 2);
    },
  );
  assert.deepEqual(sent.map((s) => s.host).sort(), ['a.com', 'b.com']);
});

test('an unset key is a deployment fault and does throw', async () => {
  const originalKey = process.env.INDEXNOW_KEY;
  delete process.env.INDEXNOW_KEY;
  try {
    await assert.rejects(() => notifyIndexNow(['https://a.com/1']), /INDEXNOW_KEY is not set/);
  } finally {
    if (originalKey !== undefined) process.env.INDEXNOW_KEY = originalKey;
  }
});
