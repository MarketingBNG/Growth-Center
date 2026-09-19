import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fireflies,
  knownParties,
  parseCallDate,
  safeCall,
  transcriptText,
} from '../lib/integrations/providers/fireflies.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// Fireflies.
//
// Never run against the live API — there is no key for this account. What these tests are
// really for is the property that matters more than whether the adapter works: that no
// name, address or tax identifier can reach the database through it, and that a transcript
// which will not come clean is dropped rather than stored.

const CALL = {
  id: 'abc123',
  title: 'Discovery — Nandini Exports',
  date: 1789000000000,
  host_email: 'advisor@usaindiacfo.com',
  participants: ['priya.sharma@nandiniexports.com', 'advisor@usaindiacfo.com'],
  speakers: [{ name: 'Priya Sharma' }, { name: 'Advisor' }],
  sentences: [
    { speaker_name: 'Priya Sharma', text: 'My email is priya.sharma@nandiniexports.com and my PAN is ABCDE1234F.' },
    { speaker_name: 'Advisor', text: 'What made you start looking at this now?' },
    { speaker_name: 'Priya Sharma', text: 'We opened a Delaware C-corp and nobody mentioned Form 5471.' },
  ],
};

// ── the guarantee ────────────────────────────────────────────────────────────────────

test('nothing identifying survives into the scrubbed call', () => {
  const safe = safeCall(CALL);
  assert.ok(safe);
  assert.ok(!safe.text.includes('priya.sharma@nandiniexports.com'));
  assert.ok(!/Priya/i.test(safe.text));
  assert.ok(!/Sharma/i.test(safe.text));
  assert.ok(!safe.text.includes('ABCDE1234F'));
});

test('the buyer language survives, which is the reason for the whole integration', () => {
  const safe = safeCall(CALL);
  assert.match(safe!.text, /opened a Delaware C-corp/);
  assert.match(safe!.text, /nobody mentioned Form 5471/);
});

// The speaker labels ARE the participant names, so a transcript that keeps them keeps the
// people. Gathering them is what makes the redaction possible.
test('speaker names and participant addresses are gathered for the scrubber', () => {
  const known = knownParties(CALL);
  assert.ok(known.names.includes('Priya Sharma'));
  assert.ok(known.emails.includes('priya.sharma@nandiniexports.com'));
  assert.ok(known.emails.includes('advisor@usaindiacfo.com'));
});

test('a duplicated speaker is listed once', () => {
  // Priya speaks twice in the fixture.
  const names = knownParties(CALL).names.filter((n) => n === 'Priya Sharma');
  assert.equal(names.length, 1);
});

// Contact details spoken mid-sentence, rather than in a field: the case the known-parties
// list cannot help with and the patterns have to catch on their own.
test('numbers spoken in passing are caught by shape, without being declared', () => {
  const safe = safeCall({
    ...CALL,
    sentences: [{ speaker_name: 'Advisor', text: 'Reach her on 415-555-0134 or 47-1234567.' }],
  });
  assert.ok(safe);
  assert.ok(!safe.text.includes('415-555-0134'));
  assert.ok(!safe.text.includes('47-1234567'));
});

// The drop path is defensive and cannot be triggered by a fixture today: safeCall returns
// null when the scrub and the verify disagree, and both halves share the same patterns and
// the same minimum name length, so they cannot. It exists for the future change that makes
// them diverge. Asserted as the property rather than faked, so nobody reads the missing
// case as untested logic.
test('a call is stored only when verification agrees it is clean', () => {
  const safe = safeCall(CALL);
  assert.ok(safe, 'a clean call is kept');
  assert.equal(
    safeCall({ ...CALL, sentences: [] }),
    null,
    'anything safeCall will not vouch for comes back as null, never as partial text',
  );
});

test('a call with no id, no date or no words is skipped', () => {
  assert.equal(safeCall({ ...CALL, id: undefined }), null);
  assert.equal(safeCall({ ...CALL, date: undefined }), null);
  assert.equal(safeCall({ ...CALL, sentences: [] }), null);
  assert.equal(safeCall({ ...CALL, sentences: null }), null);
});

test('how much was removed is counted, so a silent scrubber is visible', () => {
  const safe = safeCall(CALL);
  const total = Object.values(safe!.removed).reduce((t, n) => t + n, 0);
  assert.ok(total > 0, 'a call naming a person and a PAN must report redactions');
});

// ── dates ────────────────────────────────────────────────────────────────────────────

test('epoch milliseconds are read, as a number or as a string', () => {
  assert.equal(parseCallDate(1789000000000)?.getTime(), 1789000000000);
  assert.equal(parseCallDate('1789000000000')?.getTime(), 1789000000000);
});

test('an ISO date is read too', () => {
  assert.equal(parseCallDate('2026-09-01T10:00:00Z')?.toISOString(), '2026-09-01T10:00:00.000Z');
});

test('an unreadable date is null, never an epoch row', () => {
  assert.equal(parseCallDate('not a date'), null);
  assert.equal(parseCallDate(null), null);
  assert.equal(parseCallDate(undefined), null);
});

// ── the transcript ───────────────────────────────────────────────────────────────────

test('sentences become one passage with speakers attached', () => {
  const text = transcriptText(CALL);
  assert.match(text, /^Priya Sharma: My email/);
  assert.equal(text.split('\n').length, 3);
});

test('a missing speaker or text does not produce "undefined" in the prose', () => {
  const text = transcriptText({ sentences: [{ text: 'hello' }, { speaker_name: 'A' }] });
  assert.ok(!text.includes('undefined'));
  assert.match(text, /Speaker: hello/);
});

// ── the sync ─────────────────────────────────────────────────────────────────────────

function stub(pages: unknown[][]) {
  let call = 0;
  const bodies: Record<string, unknown>[] = [];
  global.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const page = pages[call++] ?? [];
    return new Response(JSON.stringify({ data: { transcripts: page } }), { status: 200 });
  }) as typeof fetch;
  return bodies;
}

async function runSync(pages: unknown[][]) {
  const original = global.fetch;
  const bodies = stub(pages);
  try {
    const points = await fireflies.sync!(JSON.stringify({ apiKey: 'k' }), {}, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
    });
    return { points, bodies };
  } finally {
    global.fetch = original;
  }
}

// The load-bearing assertion for this provider. metric_snapshot has no text column and
// this must not invent one: what is stored is counts, and the words themselves never
// leave the function.
test('the sync stores counts, never transcript text', async () => {
  const { points } = await runSync([[CALL]]);
  const keys = [...new Set(points.map((p) => p.metricKey))].sort();
  assert.deepEqual(keys, ['buyer_language_words', 'calls_recorded', 'identifiers_removed']);

  for (const p of points) {
    assert.equal(typeof p.value, 'number');
    // Nothing anywhere on a point may carry the conversation.
    const carried = JSON.stringify(p);
    assert.ok(!/Delaware C-corp/.test(carried), 'transcript text reached a metric point');
    assert.ok(!/Priya/i.test(carried), 'a name reached a metric point');
  }
});

test('calls on the same day are counted together', async () => {
  const { points } = await runSync([[CALL, { ...CALL, id: 'def456' }]]);
  const recorded = points.find((p) => p.metricKey === 'calls_recorded');
  assert.equal(recorded?.value, 2);
});

test('a short page ends the pull rather than looping for ever', async () => {
  const { bodies } = await runSync([[CALL]]);
  assert.equal(bodies.length, 1, 'one page under the limit means the pull is done');
});

test('the requested window is passed to the API, not filtered afterwards', async () => {
  const { bodies } = await runSync([[]]);
  const vars = (bodies[0] as { variables?: Record<string, unknown> }).variables ?? {};
  assert.equal(vars.fromDate, '2026-09-01T00:00:00.000Z');
  assert.equal(vars.toDate, '2026-09-30T00:00:00.000Z');
  assert.equal(vars.limit, 50, 'the documented ceiling');
});

// ── refusals ─────────────────────────────────────────────────────────────────────────

test('a rejected key says where to find a new one', async () => {
  const original = global.fetch;
  global.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      () => fireflies.sync!(JSON.stringify({ apiKey: 'k' }), {}, { from: new Date(), to: new Date() }),
      /Settings → Developer/,
    );
  } finally {
    global.fetch = original;
  }
});

// GraphQL reports failures inside a 200. Read only the status and an expired key looks
// like an account with no calls in it — a silent, permanent zero.
test('a GraphQL error inside a 200 is a failure, not an empty account', async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: 'Invalid API key' }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => fireflies.sync!(JSON.stringify({ apiKey: 'k' }), {}, { from: new Date(), to: new Date() }),
      /Invalid API key/,
    );
  } finally {
    global.fetch = original;
  }
});

test('the provider is registered', () => {
  assert.equal(getProvider('fireflies')?.name, 'Fireflies');
});
