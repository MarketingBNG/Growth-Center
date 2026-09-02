import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listQuery, orderBy, paged, parseQuery, slice } from '../lib/list-query.ts';
import { pageQuery, pick } from '../lib/query.ts';

// The input-validation boundary shared by the API routes and the server components —
// the code that turns a caller-supplied query string into database arguments.
//
// `route()` and `body()` are not here: they import next/server and lib/auth, which bare
// Node cannot resolve. Their auth path is covered end-to-end instead — an unauthenticated
// /api/public/v1/leads answers 401 JSON, and the e2e suite signs in with a genuinely
// signed cookie that still has to pass the roster check.

test('orderBy refuses a sort column that is not on the allow-list', () => {
  const allowed = ['createdAt', 'name'] as const;
  const q = listQuery.parse({ sort: 'createdAt', dir: 'asc' });
  assert.deepEqual(orderBy(q, allowed, 'createdAt'), { createdAt: 'asc' });

  // Anything else falls back rather than reaching Prisma as an arbitrary field.
  for (const bad of ['password', 'company.ownerEmail', '__proto__', 'id; DROP TABLE lead']) {
    const evil = listQuery.parse({ sort: bad, dir: 'desc' });
    assert.deepEqual(
      orderBy(evil, allowed, 'createdAt'),
      { createdAt: 'desc' },
      `"${bad}" must not be honoured`,
    );
  }
});

test('orderBy falls back when sort is absent', () => {
  const q = listQuery.parse({});
  assert.deepEqual(orderBy(q, ['name'] as const, 'name'), { name: 'desc' });
});

test('dir only accepts asc or desc', () => {
  assert.equal(listQuery.parse({ dir: 'asc' }).dir, 'asc');
  assert.throws(() => listQuery.parse({ dir: 'sideways' }));
  assert.equal(listQuery.parse({}).dir, 'desc');
});

test('perPage is capped so one request cannot ask for the whole table', () => {
  assert.equal(listQuery.parse({ perPage: '25' }).perPage, 25);
  assert.equal(listQuery.parse({}).perPage, 25);
  assert.throws(() => listQuery.parse({ perPage: '1000' }));
  assert.throws(() => listQuery.parse({ perPage: '0' }));
  assert.throws(() => listQuery.parse({ perPage: '-5' }));
});

test('page must be a positive integer', () => {
  assert.equal(listQuery.parse({ page: '3' }).page, 3);
  assert.throws(() => listQuery.parse({ page: '0' }));
  assert.throws(() => listQuery.parse({ page: '1.5' }));
});

test('slice turns a validated page into Prisma skip/take', () => {
  assert.deepEqual(slice(listQuery.parse({ page: '1', perPage: '25' })), { skip: 0, take: 25 });
  assert.deepEqual(slice(listQuery.parse({ page: '4', perPage: '10' })), { skip: 30, take: 10 });
});

test('a long search term is rejected rather than truncated silently', () => {
  assert.throws(() => listQuery.parse({ q: 'x'.repeat(201) }));
  assert.equal(listQuery.parse({ q: '  hello  ' }).q, 'hello');
});

test('parseQuery reads the query string off a real URL', () => {
  const req = new Request('https://example.test/api/leads?page=2&perPage=10&dir=asc');
  const q = parseQuery(req, listQuery);
  assert.equal(q.page, 2);
  assert.equal(q.perPage, 10);
  assert.equal(q.dir, 'asc');
});

test('paged echoes the validated page back to the client', () => {
  const q = listQuery.parse({ page: '2', perPage: '10' });
  assert.deepEqual(paged([1, 2], 42, q), { rows: [1, 2], total: 42, page: 2, perPage: 10 });
});

test('pageQuery never throws on a hand-edited URL, it falls back', () => {
  assert.equal(pageQuery({ page: 'abc', perPage: '9999' }).page, 1);
  assert.equal(pageQuery({ page: 'abc', perPage: '9999' }).perPage, 25);
  assert.equal(pageQuery({}).page, 1);
  // A repeated query key arrives as an array; the first usable value is taken.
  assert.equal(pageQuery({ page: ['3', '4'] }).page, 3);
});

test('pick passes through only the named string keys', () => {
  const out = pick({ status: 'new', junk: 'x', empty: '', arr: ['a'] }, ['status', 'empty', 'arr']);
  assert.deepEqual(out, { status: 'new' });
});

// ── filters read off the URL ──────────────────────────────────────────────────

test('an unreadable lead filter is ignored, not fatal', async () => {
  const { leadFilters } = await import('../lib/leads.ts');

  // The Leads page parses these straight from searchParams. Throwing here took the whole
  // page down with a 500 — `?status=bogus` did it, and so did getting the case wrong on a
  // value that exists.
  for (const bad of [
    { status: 'bogus' },
    { sourceType: 'bogus' },
    { leadSource: 'bogus' },
    { leadCampaign: 'bogus' },
    { leadSource: 'Facebook' },
    { leadCampaign: 'incorporation' },
    { from: 'not-a-date' },
    { to: '2026-13-45' },
    { campaignId: 'has spaces and $' },
    { channelId: 'x'.repeat(200) },
  ]) {
    const parsed = leadFilters.parse(bad);
    const key = Object.keys(bad)[0] as keyof typeof parsed;
    assert.equal(parsed[key], undefined, `${JSON.stringify(bad)} should be dropped, not kept`);
  }
});

test('a valid lead filter still survives the fallback', async () => {
  const { leadFilters } = await import('../lib/leads.ts');
  const ok = leadFilters.parse({
    status: 'lost',
    leadSource: 'facebook',
    leadCampaign: 'Incorporation',
    from: '2026-01-01',
  });
  assert.equal(ok.status, 'lost');
  assert.equal(ok.leadSource, 'facebook');
  assert.equal(ok.leadCampaign, 'Incorporation');
  assert.equal(ok.from, '2026-01-01');
});

test('one bad filter does not discard the good ones beside it', async () => {
  const { leadFilters } = await import('../lib/leads.ts');
  const mixed = leadFilters.parse({ status: 'lost', leadSource: 'bogus' });
  assert.equal(mixed.status, 'lost');
  assert.equal(mixed.leadSource, undefined);
});
