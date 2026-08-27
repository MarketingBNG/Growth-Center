import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insightValues,
  measured,
  parseTime,
  inRange,
  walkedPast,
} from '../lib/integrations/providers/meta-social.ts';
import { searchConsole } from '../lib/integrations/providers/search-console.ts';
import { readCursor } from '../lib/integrations/providers/zoho-crm.ts';
import { seoLiveness } from '../lib/seo.ts';
import { PROVIDERS } from '../lib/integrations/registry.ts';
import { leadSourceType, leadStatus, matchStage } from '../lib/integrations/crm-mapping.ts';

// The parts of the new providers that can be tested without a live API: the parsing of
// what the platform sends back, and the normalising of what a person types in.

test('insightValues takes the last value, which is what a lifetime metric means', () => {
  // Follower counts arrive as a series; the newest is the current one.
  const out = insightValues({
    data: [
      { name: 'reach', values: [{ value: 10 }, { value: 40 }] },
      { name: 'impressions', values: [{ value: 7 }] },
    ],
  });
  assert.deepEqual(out, { reach: 40, impressions: 7 });
});

test('insightValues drops non-numeric and empty metrics rather than coercing them', () => {
  // Meta returns objects for some breakdowns. Number({}) is NaN, which would be written
  // into a numeric column as a real reading.
  const out = insightValues({
    data: [
      { name: 'shaped', values: [{ value: { total: 3 } as unknown as number }] },
      { name: 'empty', values: [] },
      { name: 'missing' },
      { name: 'good', values: [{ value: 0 }] },
    ],
  });
  assert.deepEqual(out, { good: 0 });
});

test('insightValues survives an error payload with no data', () => {
  assert.deepEqual(insightValues({}), {});
});

test('parseTime rejects what would become an Invalid Date', () => {
  assert.equal(parseTime(undefined), null);
  assert.equal(parseTime('not a date'), null);
  // Graph's own format, offset and all.
  assert.equal(parseTime('2026-08-24T11:02:30+0000')?.toISOString(), '2026-08-24T11:02:30.000Z');
});

const normaliseSite = (v: string) => searchConsole.configFields![0].normalise!(v);

test('a Search Console URL-prefix property keeps its trailing slash', () => {
  // Google matches the property string exactly and always stores the slash; without it
  // every query 403s with a message that never mentions the slash.
  assert.equal(normaliseSite('https://usaindiacfo.com'), 'https://usaindiacfo.com/');
  assert.equal(normaliseSite('https://usaindiacfo.com/'), 'https://usaindiacfo.com/');
});

test('a bare domain is read as a domain property', () => {
  assert.equal(normaliseSite('usaindiacfo.com'), 'sc-domain:usaindiacfo.com');
  assert.equal(normaliseSite('sc-domain:usaindiacfo.com'), 'sc-domain:usaindiacfo.com');
});

test('an unusable property string is rejected at the form, not at the first sync', () => {
  assert.throws(() => normaliseSite('my website'), /sc-domain/);
});

test('seoLiveness reports per row, so live and seeded can coexist', () => {
  assert.deepEqual(seoLiveness([]), { live: 0, seeded: 0, hasLive: false, allLive: false });

  // An empty table is not "all live" — the page must not drop its warning over no rows.
  assert.equal(seoLiveness([]).allLive, false);

  const mixed = seoLiveness([{ source: 'google_search_console' }, { source: null }]);
  assert.deepEqual(mixed, { live: 1, seeded: 1, hasLive: true, allLive: false });

  const all = seoLiveness([{ source: 'google_search_console' }]);
  assert.equal(all.allLive, true);
});

test('the new providers are registered under the ids their Integration rows already use', () => {
  // google_search_console already existed as a disconnected row from the seeder. A
  // provider registered under a different id would leave that row orphaned and render a
  // second card for the same thing.
  assert.ok(PROVIDERS.google_search_console);
  assert.ok(PROVIDERS.meta_social);
  assert.equal(PROVIDERS.meta_social.category, 'social');
  assert.equal(PROVIDERS.google_search_console.category, 'seo');
});

test('the social provider asks for read scopes only — there is no publishing here', () => {
  const url = PROVIDERS.meta_social.getAuthUrl('https://example.com/cb', 'state') ?? '';
  const scope = new URL(url).searchParams.get('scope') ?? '';
  for (const forbidden of ['publish', 'manage_posts', 'content_publish']) {
    assert.ok(!scope.includes(forbidden), `scope must not request ${forbidden}`);
  }
  assert.ok(scope.includes('instagram_basic'));
  assert.ok(scope.includes('pages_read_engagement'));
});

// ── the window Instagram does not apply for us ────────────────────────────────

const RANGE = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

test('inRange keeps the window inclusive at both ends', () => {
  assert.equal(inRange(RANGE.from, RANGE), true);
  assert.equal(inRange(RANGE.to, RANGE), true);
  assert.equal(inRange(new Date('2026-07-31T23:59:59Z'), RANGE), false);
  assert.equal(inRange(new Date('2026-09-01T00:00:00Z'), RANGE), false);
});

test('walkedPast stops paging only once media older than the window appears', () => {
  // /media ignores since/until, so this is the only thing keeping Instagram from
  // fetching an account's entire history on every sync.
  assert.equal(walkedPast([{ timestamp: '2026-08-20T10:00:00+0000' }], RANGE.from), false);
  assert.equal(walkedPast([{ timestamp: '2026-07-28T10:00:00+0000' }], RANGE.from), true);
  // An unparseable timestamp must not read as "older than the window" and cut the walk
  // short, nor as a reason to keep paging past the cap.
  assert.equal(walkedPast([{ timestamp: undefined }, { timestamp: 'nonsense' }], RANGE.from), false);
  assert.equal(walkedPast([], RANGE.from), false);
});

test('measured omits what the platform never reported, and keeps a genuine zero', () => {
  // The distinction the whole helper exists for: a swallowed insights error leaves the
  // column at its default, while a reported 0 is written as the reading it is.
  assert.deepEqual(measured({ reach: 0, impressions: undefined, likes: 4 }), {
    reach: 0,
    likes: 4,
  });
});

test('the social provider advertises saves separately from shares', () => {
  // They are different actions on different networks. Listing only "Shares" is what let
  // Instagram's saves be written into that column in the first place.
  assert.ok(PROVIDERS.meta_social.provides.includes('Saves'));
  assert.ok(PROVIDERS.meta_social.provides.includes('Shares'));
});

// ── Zoho CRM record import ─────────────────────────────────────────────────────
// The mapping is the risky half of the import: a mis-mapped stage moves money between
// pipeline columns, and a mis-mapped status hides a live lead from the Leads page.

test('leadStatus tests "Not Qualified" before "Qualified"', () => {
  // Zoho's own default picklist contains both, and one is a substring of the other. Get
  // the order wrong and every dead lead reads as qualified.
  assert.equal(leadStatus('Not Qualified'), 'unqualified');
  assert.equal(leadStatus('Qualified'), 'qualified');
  assert.equal(leadStatus('Junk Lead'), 'lost');
  assert.equal(leadStatus('Contacted'), 'contacted');
  assert.equal(leadStatus('Attempted to Contact'), 'contacted');
});

test('leadStatus leaves an unrecognised org-specific status as new', () => {
  // Lead_Status is free text per org. Guessing would silently reclassify the funnel.
  assert.equal(leadStatus('Awaiting Partner Review'), 'new');
  assert.equal(leadStatus(null), 'new');
  assert.equal(leadStatus(''), 'new');
});

test('leadSourceType falls back to import rather than inventing a channel', () => {
  // Attribution nobody reported is a fabrication, and it lands in the funnel charts.
  assert.equal(leadSourceType('Something Bespoke'), 'import');
  assert.equal(leadSourceType(null), 'import');
  assert.equal(leadSourceType('External Referral'), 'referral');
  assert.equal(leadSourceType('Web Download'), 'website');
  assert.equal(leadSourceType('Trade Show'), 'event');
});

const STAGES = [
  { id: 'd', name: 'Discovery', position: 0, probability: 15, isWon: false, isLost: false },
  { id: 'p', name: 'Proposal', position: 2, probability: 60, isWon: false, isLost: false },
  { id: 'w', name: 'Won', position: 4, probability: 100, isWon: true, isLost: false },
  { id: 'l', name: 'Lost', position: 5, probability: 0, isWon: false, isLost: true },
];

test('matchStage prefers an exact name, case-insensitively', () => {
  assert.equal(matchStage(STAGES, 'proposal')?.id, 'p');
  assert.equal(matchStage(STAGES, 'Proposal')?.id, 'p');
});

test('matchStage recognises Zoho\'s two built-in closed stages', () => {
  assert.equal(matchStage(STAGES, 'Closed Won')?.id, 'w');
  assert.equal(matchStage(STAGES, 'Closed Lost')?.id, 'l');
});

test('matchStage never guesses an unknown stage into Won or Lost', () => {
  // The whole reason this is a named function: a wrong guess here writes a live deal
  // into closed-won revenue, and every pipeline figure on the page is then wrong.
  const stage = matchStage(STAGES, 'Legal Review');
  assert.equal(stage?.id, 'd');
  assert.equal(stage?.isWon, false);
  assert.equal(stage?.isLost, false);
});

test('matchStage picks the first OPEN stage by position, not the first row returned', () => {
  const shuffled = [...STAGES].reverse();
  assert.equal(matchStage(shuffled, 'Legal Review')?.id, 'd');
});

test('matchStage returns null rather than throwing when a pipeline has no stages', () => {
  assert.equal(matchStage([], 'Proposal'), null);
});

test('the Zoho provider advertises the records it now imports', () => {
  // It shipped writing three record_count numbers that nothing read. The card should not
  // be able to drift back to claiming records it does not materialise.
  for (const claim of ['Leads', 'Contacts', 'Deals', 'Accounts']) {
    assert.ok(PROVIDERS.zoho_crm.provides.includes(claim), claim);
  }
});

// ── resumable syncs ────────────────────────────────────────────────────────────
// The cursor is what lets a 39,000-record backfill span several runs. A cursor that
// cannot be read back is an integration that restarts its import forever.

test('readCursor starts a fresh pull when there is nothing stored', () => {
  assert.deepEqual(readCursor(null), { module: 'Leads', page: 1, pageToken: null });
  assert.deepEqual(readCursor(undefined), { module: 'Leads', page: 1, pageToken: null });
});

test('readCursor round-trips a cursor it wrote', () => {
  const cursor = { module: 'Deals', page: 7, pageToken: 'abc123' };
  assert.deepEqual(readCursor(cursor), cursor);
});

test('readCursor restarts rather than throwing on a cursor it does not recognise', () => {
  // A cursor written by an older version, or naming a module since removed. Restarting
  // costs one pass; throwing would wedge the integration with no way out from the UI.
  assert.equal(readCursor({ module: 'Invoices', page: 4 }).module, 'Leads');
  assert.equal(readCursor({ module: 'Deals', page: 'nonsense' }).page, 1);
  assert.equal(readCursor({ module: 'Deals', page: -3 }).page, 1);
  assert.equal(readCursor('a string').module, 'Leads');
});

test('readCursor treats an empty page token as absent', () => {
  // '' would be sent as page_token= and Zoho would reject the request.
  assert.equal(readCursor({ module: 'Leads', page: 2, pageToken: '' }).pageToken, null);
});

test('every registered provider implements sync or syncPaged', () => {
  // The contract went from one required method to two optional ones. A provider with
  // neither would type-check and then fail only at sync time, in production.
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    assert.ok(provider.sync ?? provider.syncPaged, `${id} implements neither`);
  }
});
