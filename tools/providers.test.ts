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
import { readCursor, repairEncoding } from '../lib/integrations/providers/zoho-crm.ts';
import {
  prospectStatus,
  readCursor as smartleadCursor,
  sequenceStatus,
} from '../lib/integrations/providers/smartlead.ts';
import { seoLiveness } from '../lib/seo.ts';
import { PROVIDERS } from '../lib/integrations/registry.ts';
import { splitName } from '../lib/integrations/service.ts';
import { leadSourceType, leadStatus, matchStage, taskPriority, taskStatus } from '../lib/integrations/crm-mapping.ts';

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

test('readCursor starts a fresh pull at the FIRST module, not a named one', () => {
  // The pull walks the module list forwards, so a hardcoded starting point silently skips
  // everything ordered before it — which is how adding Accounts ahead of Leads meant
  // Accounts was never fetched at all.
  assert.deepEqual(readCursor(null), { module: 'Accounts', page: 1, pageToken: null });
  assert.deepEqual(readCursor(undefined), { module: 'Accounts', page: 1, pageToken: null });
});

test('readCursor round-trips a cursor it wrote', () => {
  const cursor = { module: 'Deals', page: 7, pageToken: 'abc123' };
  assert.deepEqual(readCursor(cursor), cursor);
});

test('readCursor restarts rather than throwing on a cursor it does not recognise', () => {
  // A cursor written by an older version, or naming a module since removed. Restarting
  // costs one pass; throwing would wedge the integration with no way out from the UI.
  assert.equal(readCursor({ module: 'Invoices', page: 4 }).module, 'Accounts');
  assert.equal(readCursor({ module: 'Deals', page: 'nonsense' }).page, 1);
  assert.equal(readCursor({ module: 'Deals', page: -3 }).page, 1);
  assert.equal(readCursor('a string').module, 'Accounts');
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

// ── mojibake ───────────────────────────────────────────────────────────────────
// Names arrived on the Pipeline board as "ÃÂ¤ÃÂ°ÃÂ¾…". The records went into Zoho
// already broken, so the repair has to happen on the way in.

test('repairEncoding recovers a doubly-encoded name', () => {
  const original = 'श्री राम';
  const once = Buffer.from(original, 'utf8').toString('latin1');
  const twice = Buffer.from(once, 'utf8').toString('latin1');
  assert.equal(repairEncoding(twice), original);
});

test('repairEncoding recovers a singly-encoded name', () => {
  const original = 'Ronak Śhah';
  const once = Buffer.from(original, 'utf8').toString('latin1');
  assert.equal(repairEncoding(once), original);
});

test('repairEncoding leaves ordinary accented text alone', () => {
  // The failure that would matter more than the bug: mangling names that are fine.
  for (const name of ['Renée Dubois', 'José Muñoz', 'Ronak Shah', 'Åsa Lindqvist', '']) {
    assert.equal(repairEncoding(name), name);
  }
});

test('repairEncoding leaves text that is already correct in its own script', () => {
  for (const name of ['श्री राम', '株式会社テスト', 'Ελένη']) {
    assert.equal(repairEncoding(name), name);
  }
});

test('repairEncoding is idempotent', () => {
  const broken = Buffer.from('श्री', 'utf8').toString('latin1');
  assert.equal(repairEncoding(repairEncoding(broken)), repairEncoding(broken));
});

// ── Smartlead ──────────────────────────────────────────────────────────────────

test('sequenceStatus maps Smartlead campaign states onto the app vocabulary', () => {
  assert.equal(sequenceStatus('ACTIVE'), 'active');
  assert.equal(sequenceStatus('PAUSED'), 'paused');
  assert.equal(sequenceStatus('COMPLETED'), 'archived');
  assert.equal(sequenceStatus('DRAFTED'), 'draft');
  assert.equal(sequenceStatus(null), 'draft');
});

test('prospectStatus lets a real reply outrank the campaign state', () => {
  // A lead marked INPROGRESS that has actually replied is a reply. Showing it as merely
  // active is the difference between someone following up and not.
  assert.equal(prospectStatus('INPROGRESS', { replied: true }), 'replied');
  assert.equal(prospectStatus('INPROGRESS'), 'active');
  assert.equal(prospectStatus('COMPLETED'), 'completed');
  assert.equal(prospectStatus('STARTED'), 'pending');
  assert.equal(prospectStatus('BLOCKED'), 'unsubscribed');
});

test('prospectStatus ranks unsubscribed above bounced above replied', () => {
  // All three can be true at once on a lead that replied, later bounced, then opted out.
  // The most final one is the truth about where that address stands now.
  const all = { replied: true, bounced: true, unsubscribed: true };
  assert.equal(prospectStatus('INPROGRESS', all), 'unsubscribed');
  assert.equal(prospectStatus('INPROGRESS', { replied: true, bounced: true }), 'bounced');
});

test('smartleadCursor restarts on anything it cannot read', () => {
  assert.equal(smartleadCursor(null), null);
  assert.equal(smartleadCursor({ index: 2 }), null); // no ids — nothing to resume through
  assert.deepEqual(smartleadCursor({ ids: [7, 8], index: 1, stage: 'leads', offset: 200 }), {
    ids: [7, 8],
    index: 1,
    stage: 'leads',
    offset: 200,
  });
  assert.equal(smartleadCursor({ ids: [7], index: -1, stage: 'nope', offset: 'x' })?.index, 0);
  assert.equal(smartleadCursor({ ids: [7], index: 0, stage: 'nope', offset: 0 })?.stage, 'sequences');
});

test('Smartlead needs no environment variables, so the card is connectable as shipped', () => {
  // The key is supplied through the UI. A requiredEnv entry would grey the card out and
  // leave no way to enter one.
  assert.deepEqual(PROVIDERS.smartlead.requiredEnv, []);
  assert.equal(PROVIDERS.smartlead.isConfigured(), true);
  assert.equal(PROVIDERS.smartlead.authKind, 'apiKey');
});

// ── name assembly ──────────────────────────────────────────────────────────────
// splitName is not exported — it is exercised here through the shape it has to produce.
// Zoho makes Last_Name mandatory and First_Name optional, so most records carry the whole
// name in Last_Name alone, and 21,151 leads rendered as "Irshad Alli Irshad Alli".

test('a lone name goes in firstName so joining the two does not repeat it', () => {
  const join = (n: { firstName: string; lastName: string | null }) =>
    [n.firstName, n.lastName].filter(Boolean).join(' ');

  assert.equal(join(splitName('Basisth', 'Jha', undefined, 'x')), 'Basisth Jha');
  assert.equal(join(splitName(null, 'Irshad Alli', 'Irshad Alli', 'x')), 'Irshad Alli');
  assert.equal(join(splitName('Sanju', null, 'Sanju', 'x')), 'Sanju');
  // Nothing usable at all still has to satisfy a NOT NULL column.
  assert.equal(join(splitName(null, null, undefined, 'lead-9931')), 'lead-9931');
});

const STAGE_NAMES = [
  'Open Deal Flow',
  'Qualified Deal',
  'Deal Complete',
  'Project In Progress',
  'Project Completed',
  'Deal Lost',
];

test('taskStatus keeps deferred and waiting work open', () => {
  // Neither has been done nor called off, so marking them done would hide live work.
  assert.equal(taskStatus('Deferred'), 'open');
  assert.equal(taskStatus('Waiting for input'), 'open');
  assert.equal(taskStatus('Not Started'), 'open');
  assert.equal(taskStatus('In Progress'), 'in_progress');
  // Misspelt in the CRM itself, on nine tasks.
  assert.equal(taskStatus('In Proress'), 'in_progress');
  assert.equal(taskStatus('Completed'), 'done');
  assert.equal(taskStatus(null), 'open');
});

test('taskPriority tests the extremes before the words they contain', () => {
  // "Highest" contains "high" and "Lowest" contains "low", so order decides correctness.
  assert.equal(taskPriority('Highest'), 'urgent');
  assert.equal(taskPriority('High'), 'high');
  assert.equal(taskPriority('Lowest'), 'low');
  assert.equal(taskPriority('Low'), 'low');
  assert.equal(taskPriority('Normal'), 'normal');
  assert.equal(taskPriority(undefined), 'normal');
});

test('the pipeline stages match the ones the CRM actually sends', () => {
  // The seeded pipeline used generic names, so every imported deal fell through to the
  // first open stage and the pipeline showed as a single column.
  const stages = STAGE_NAMES.map((name, i) => ({
    id: String(i),
    name,
    position: i,
    probability: 0,
    isWon: name === 'Deal Complete' || name.startsWith('Project'),
    isLost: name === 'Deal Lost',
  }));
  for (const name of STAGE_NAMES) {
    assert.equal(matchStage(stages, name)?.name, name);
  }
  assert.equal(matchStage(stages, 'Deal Complete')?.isWon, true);
  assert.equal(matchStage(stages, 'Deal Lost')?.isLost, true);
});


test('leadStatus reads the wording this CRM actually uses, not Zoho defaults', () => {
  // Every one of these fell through to `new` before, which is how 22,554 of 26,151 leads
  // came to read as untouched: "Dead Lead" alone is most of the CRM.
  assert.equal(leadStatus('Dead Lead'), 'lost');
  assert.equal(leadStatus('Lead Lost'), 'lost');
  assert.equal(leadStatus('Follow-up'), 'contacted');
  assert.equal(leadStatus('Not Reachable'), 'contacted');
  assert.equal(leadStatus('Looking For Job'), 'unqualified');
  assert.equal(leadStatus('Untouched Lead'), 'new');
  assert.equal(leadStatus('Qualified'), 'qualified');
  assert.equal(leadStatus('Semi-Qualified Lead'), 'qualified');
});

test('leadStatus still tests "not qualified" before "qualified"', () => {
  assert.equal(leadStatus('Not Qualified'), 'unqualified');
});

test('leadSourceType maps the source names this CRM actually writes', () => {
  // Every value below is a real Lead_Source from the account. Before these, 22,887 of
  // 26,151 leads sat in `import` and exactly one lead in the whole CRM was a referral.
  assert.equal(leadSourceType('ig'), 'social');
  assert.equal(leadSourceType('fb'), 'social');
  assert.equal(leadSourceType('Facebook'), 'social');
  assert.equal(leadSourceType('Whatsapp'), 'social');
  assert.equal(leadSourceType('Old Incorp LinkedIn'), 'social');
  // Misspelled in the CRM, and there are thousands of them.
  assert.equal(leadSourceType('Incorporation LinkdIn'), 'social');

  assert.equal(leadSourceType('Meta Ads'), 'paid_ads');
  assert.equal(leadSourceType('Canada Meta Ads'), 'paid_ads');
  // An ad pointing at a landing page is still the ad.
  assert.equal(leadSourceType('Meta - Landing Page'), 'paid_ads');

  assert.equal(leadSourceType('Ref by AN'), 'referral');
  assert.equal(leadSourceType('Ref by NG'), 'referral');
  assert.equal(leadSourceType('Personal Ref'), 'referral');
  assert.equal(leadSourceType('Reference'), 'referral');

  assert.equal(leadSourceType('Landing Page'), 'landing_page');
  assert.equal(leadSourceType('Trademark - Landingpage'), 'landing_page');
  assert.equal(leadSourceType('Calendly'), 'event');
  assert.equal(leadSourceType('Zoho Bookings'), 'event');
  assert.equal(leadSourceType('Call'), 'outreach');
  // Someone went looking for this prospect; they did not arrive via Google.
  assert.equal(leadSourceType('Web Research'), 'outreach');
  assert.equal(leadSourceType('Zoho Desk'), 'website');
});

test('leadSourceType does not name a channel the CRM never named', () => {
  assert.equal(leadSourceType('Excel CRM'), 'import');
  assert.equal(leadSourceType(null), 'import');
  assert.equal(leadSourceType(''), 'import');
  assert.equal(leadSourceType('Platform'), 'import');
});

test('a two-letter source is matched whole, never as a substring', () => {
  // includes("ig") would make every Landing Page lead social.
  assert.equal(leadSourceType('Landing Page'), 'landing_page');
  assert.notEqual(leadSourceType('Zoho Bookings'), 'social');
});
