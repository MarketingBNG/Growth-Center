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
import {
  channelSlugFor,
  cleanImportedName,
  LEAD_CAMPAIGNS,
  leadCampaign,
  LEAD_SOURCES,
  leadSourceGroup,
  leadSourceLabel,
  leadSourceType,
  leadStatus,
  matchStage,
  taskPriority,
  taskStatus,
} from '../lib/integrations/crm-mapping.ts';

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
  // Same trap as "Not Qualified": includes('contact') reads this as its own opposite.
  assert.equal(leadStatus('Not Contacted'), 'new');
  assert.equal(leadStatus('not contacted'), 'new');
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

test('the [MERGED] tag Zoho writes into a name is not part of the name', () => {
  const join = (n: { firstName: string; lastName: string | null }) =>
    [n.firstName, n.lastName].filter(Boolean).join(' ');

  assert.equal(cleanImportedName('[MERGED] Arif Ibrahim'), 'Arif Ibrahim');
  assert.equal(cleanImportedName('[merged]  Rani'), 'Rani');
  assert.equal(cleanImportedName('  [Merged] Dr Pinki Gangwar'), 'Dr Pinki Gangwar');
  assert.equal(join(splitName('[MERGED] Arif', 'Ibrahim', undefined, 'x')), 'Arif Ibrahim');
  assert.equal(join(splitName(null, '[MERGED] wajahat khan', undefined, 'x')), 'wajahat khan');

  // Only that exact prefix. Brackets are part of real names in this data, and a general
  // rule would eat them.
  assert.equal(cleanImportedName('Paramasivam [He/Him/His] PhD'), 'Paramasivam [He/Him/His] PhD');
  assert.equal(cleanImportedName('[AK] Anand'), '[AK] Anand');
  assert.equal(cleanImportedName('Madiwalar [Target Leads Provider]'), 'Madiwalar [Target Leads Provider]');
  assert.equal(cleanImportedName('Merged Traders Pvt Ltd'), 'Merged Traders Pvt Ltd');

  // A name that was nothing but the tag falls through to the next candidate.
  assert.equal(cleanImportedName('[MERGED]'), null);
  assert.equal(join(splitName('[MERGED]', null, 'Sanju', 'x')), 'Sanju');
  assert.equal(cleanImportedName(null), null);
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
});

test('"Semi-Qualified Lead" is its own status, not a qualified one', () => {
  // It contains the word, so it used to fold into `qualified` — 2,480 semi-qualified
  // leads against 10 fully qualified ones, under one label. The team's own decision is
  // that the two are different stages, so they are counted separately.
  assert.equal(leadStatus('Semi-Qualified Lead'), 'semi_qualified');
  assert.equal(leadStatus('semi qualified'), 'semi_qualified');
  assert.equal(leadStatus('Qualified'), 'qualified');
  // Still not a seminar.
  assert.equal(leadStatus('Seminar Attendee'), 'new');
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

test('channelSlugFor tells the platforms apart, which SourceType cannot', () => {
  // All four are `social` to SourceType, and they are 17,789 of this account's leads.
  assert.equal(channelSlugFor('social', 'ig'), 'instagram');
  assert.equal(channelSlugFor('social', 'fb'), 'facebook');
  assert.equal(channelSlugFor('social', 'Facebook'), 'facebook');
  assert.equal(channelSlugFor('social', 'Whatsapp'), 'whatsapp');
  assert.equal(channelSlugFor('social', 'Old Incorp LinkedIn'), 'linkedin');
  // Misspelt in the CRM on thousands of leads.
  assert.equal(channelSlugFor('social', 'Incorporation LinkdIn'), 'linkedin');
});

test('channelSlugFor reaches the sources that were landing nowhere', () => {
  // Every one of these was a real `sourceDetail` on a lead with no channel at all.
  // The campaign name is not always the prefix, so "meta" is matched as a word.
  assert.equal(channelSlugFor('import', 'Trademark_Meta'), 'meta-ads');
  // ...but as a whole word only. A rule of `includes('meta')` would swallow this.
  assert.equal(channelSlugFor('import', 'Metallurgy Ltd'), null);

  assert.equal(channelSlugFor('import', 'Convergence India Expo 2026'), 'events');
  assert.equal(channelSlugFor('import', 'Discovery Meet: AI Impact Summit'), 'events');
  // Smartlead is the cold-email tool, so the lead came from outreach.
  assert.equal(channelSlugFor('import', 'Smartlead'), 'outreach');
  assert.equal(channelSlugFor('import', 'USAIndiaCFO Site'), 'direct');
  // A third spelling of LinkedIn, on one lead.
  assert.equal(channelSlugFor('import', 'LinkediIn'), 'linkedin');
});

test("the firm's own brands are direct, and nothing else is guessed", () => {
  // The podcast and the firm's own site are Direct — a decision, not an inference from
  // the name. The incorporation service is no longer among them: 934 leads is a channel
  // the Marketing page should be able to report on, not a share of Direct.
  // Everything still genuinely unknown stays null: inventing a channel would be inventing
  // the attribution the Marketing page is read for.
  assert.equal(channelSlugFor('import', 'BNG US Incorp'), 'incorp');
  assert.equal(channelSlugFor('import', 'NG Podcast'), 'direct');
  assert.equal(channelSlugFor('import', 'Platform'), null);
  assert.equal(channelSlugFor('import', 'Excel CRM'), null);
  // "Incorporation LinkdIn" is thousands of leads and must stay LinkedIn, not become
  // Direct just because it contains "incorp".
  assert.equal(channelSlugFor('social', 'Incorporation LinkdIn'), 'linkedin');
  assert.equal(channelSlugFor('social', 'Old Incorp LinkedIn'), 'linkedin');
  assert.equal(channelSlugFor('paid_ads', 'Incorporation Google Ads'), 'google-ads');
});

test('a paid source is an ad, not the organic platform it runs on', () => {
  assert.equal(channelSlugFor('paid_ads', 'Meta Ads'), 'meta-ads');
  assert.equal(channelSlugFor('paid_ads', 'Meta - Landing Page'), 'meta-ads');
  // The market comes first. 365 leads were reported as Meta Ads and could not be told
  // apart from the rest of Meta's spend.
  assert.equal(channelSlugFor('paid_ads', 'Canada Meta Ads'), 'canada');
});

test('channelSlugFor and leadSourceGroup cannot disagree', () => {
  // They were separate copies of the same rules and drifted — the Leads page said Canada
  // while Marketing said Meta Ads. The group key IS the slug now, and this is what keeps
  // that true for every source the CRM writes.
  const sources = [
    'ig', 'fb', 'Facebook', 'Whatsapp', 'WhatsApp - USAINDIACFO', 'Incorporation LinkdIn',
    'Old Incorp LinkedIn', 'Hiring LinkedIn Ads', 'LinkediIn', 'VCFO linkdin',
    'Trademark Google Ads', 'Incorporation Google Ads', 'Meta Ads', 'Trademark_Meta',
    'Meta-VCFO', 'Meta - Landing Page', 'Canada Meta Ads', 'Landing Page',
    'Trademark - Landingpage', 'Global Landing Page', 'BNG US Incorp', 'BTS Event',
    'Calendly', 'Outbound-Calendly', 'Ref by NG', 'Personal Ref', 'Call', 'Smartlead',
    'Web Research', 'Email', 'USAIndiaCFO Site', 'NG Podcast', 'Zoho Desk',
  ];
  for (const detail of sources) {
    assert.equal(
      channelSlugFor(leadSourceType(detail), detail),
      leadSourceGroup(detail),
      `${detail} reaches a different channel than the source the Leads page shows`,
    );
  }
  // The two keys that deliberately reach no channel.
  assert.equal(leadSourceGroup('Excel CRM'), 'other');
  assert.equal(channelSlugFor('import', 'Excel CRM'), null);
});

test('channelSlugFor covers the remaining sources this account uses', () => {
  assert.equal(channelSlugFor('event', 'Calendly'), 'events');
  assert.equal(channelSlugFor('event', 'Zoho Bookings'), 'events');
  assert.equal(channelSlugFor('outreach', 'Call'), 'outreach');
  assert.equal(channelSlugFor('outreach', 'Web Research'), 'outreach');
  assert.equal(channelSlugFor('referral', 'Ref by AN'), 'referral');
  // Its own channel now, not a share of Direct — 2,534 leads.
  assert.equal(channelSlugFor('landing_page', 'Landing Page'), 'landing-page');
  assert.equal(channelSlugFor('landing_page', 'Trademark - Landingpage'), 'landing-page');
  assert.equal(channelSlugFor('organic_search', null), 'organic-search');
});

test('channelSlugFor refuses to invent attribution', () => {
  // The CRM recorded no source for these; naming a channel would put invented
  // attribution into every ROAS figure on the Marketing page.
  assert.equal(channelSlugFor('import', 'Excel CRM'), null);
  assert.equal(channelSlugFor('import', null), null);
  assert.equal(channelSlugFor('manual', ''), null);
  // Unrecognised social with no detail still has nowhere honest to go.
  assert.equal(channelSlugFor('social', null), null);
});

// ─── the CRM's own lead source, grouped ───────────────────────────────────────
//
// The Leads page filters and labels its Source column with leadSourceGroup, so these are
// the 56 strings this workspace's Zoho actually writes, not invented ones. Counts are
// from the live table and are what makes a regression here visible: fold "Canada Meta
// Ads" back into Meta Ads and 365 leads stop being findable.

test('leadSourceGroup keeps the platforms Zoho tells apart and sourceType does not', () => {
  assert.equal(leadSourceGroup('ig'), 'instagram');
  assert.equal(leadSourceGroup('fb'), 'facebook');
  assert.equal(leadSourceGroup('Facebook'), 'facebook');
  assert.equal(leadSourceGroup('Whatsapp'), 'whatsapp');
  assert.equal(leadSourceGroup('WhatsApp - USAINDIACFO-+917232075551'), 'whatsapp');

  // All four are `social` to sourceType — 17,989 leads under one word, which is what the
  // Source column used to say.
  for (const v of ['ig', 'fb', 'Facebook', 'Whatsapp']) {
    assert.equal(leadSourceType(v), 'social');
  }
});

test('leadSourceGroup reads the platform through the business line', () => {
  // Five campaign prefixes crossed with four platforms. The prefix is the campaign; the
  // platform is the source.
  assert.equal(leadSourceGroup('Incorporation LinkdIn'), 'linkedin');
  assert.equal(leadSourceGroup('Old Incorp LinkedIn'), 'linkedin');
  assert.equal(leadSourceGroup('Hiring LinkedIn Ads'), 'linkedin');
  assert.equal(leadSourceGroup('IRS LinkedIn Ads'), 'linkedin');
  assert.equal(leadSourceGroup('VCFO linkdin'), 'linkedin');
  assert.equal(leadSourceGroup('LinkediIn'), 'linkedin');

  assert.equal(leadSourceGroup('Trademark Google Ads'), 'google-ads');
  assert.equal(leadSourceGroup('Incorporation Google Ads'), 'google-ads');
  assert.equal(leadSourceGroup('IRS Google Ads'), 'google-ads');

  assert.equal(leadSourceGroup('Meta Ads'), 'meta-ads');
  assert.equal(leadSourceGroup('Meta-VCFO'), 'meta-ads');
  // Underscored, and the word is not the prefix.
  assert.equal(leadSourceGroup('Trademark_Meta'), 'meta-ads');
});

test('leadSourceGroup reports Canada on its own, before the platform', () => {
  // The one value that names a market. Folded into Meta Ads it was invisible, which is
  // the bug this group exists for.
  assert.equal(leadSourceGroup('Canada Meta Ads'), 'canada');
  assert.notEqual(leadSourceGroup('Canada Meta Ads'), leadSourceGroup('Meta Ads'));
});

test('leadSourceGroup puts a paid landing page under the ad that paid for it', () => {
  // Both contain "landing". The precedence is the same one leadSourceType applies: the
  // money spent is the more useful fact.
  assert.equal(leadSourceGroup('Meta - Landing Page'), 'meta-ads');
  assert.equal(leadSourceGroup('Landing Page'), 'landing-page');
  assert.equal(leadSourceGroup('Trademark - Landingpage'), 'landing-page');
  assert.equal(leadSourceGroup('Global Landing Page'), 'landing-page');
});

test('leadSourceGroup keeps Incorp to the incorporation service itself', () => {
  // "BNG US Incorp" is the service. The three sources that advertise it are their
  // platforms, tested above — this must not swallow them.
  assert.equal(leadSourceGroup('BNG US Incorp'), 'incorp');
  assert.equal(leadSourceGroup('Incorporation LinkdIn'), 'linkedin');
  assert.equal(leadSourceGroup('Incorporation Google Ads'), 'google-ads');
});

test('leadSourceGroup handles the long tail the same way channelSlugFor does', () => {
  assert.equal(leadSourceGroup('BTS Event'), 'events');
  assert.equal(leadSourceGroup('Convergence India Expo 2026'), 'events');
  assert.equal(leadSourceGroup('Discovery Meet: AI Impact Summit'), 'events');
  assert.equal(leadSourceGroup('Zoho Bookings'), 'events');
  // Contains "Outbound", and is still a booked meeting.
  assert.equal(leadSourceGroup('Outbound-Calendly'), 'events');

  assert.equal(leadSourceGroup('Ref by NG'), 'referral');
  assert.equal(leadSourceGroup('Personal Ref'), 'referral');
  assert.equal(leadSourceGroup('Reference'), 'referral');
  assert.equal(leadSourceGroup('Partner Reference'), 'referral');

  assert.equal(leadSourceGroup('Call'), 'outreach');
  assert.equal(leadSourceGroup('Smartlead'), 'outreach');
  // Before the website test, or looking for a prospect reads as one arriving.
  assert.equal(leadSourceGroup('Web Research'), 'outreach');

  assert.equal(leadSourceGroup('Sales Email Alias'), 'email');
  assert.equal(leadSourceGroup('USAIndiaCFO Site'), 'direct');
  assert.equal(leadSourceGroup('NG Podcast'), 'direct');
  assert.equal(leadSourceGroup('Zoho Desk'), 'direct');
});

test('leadSourceGroup names what it does not recognise rather than guessing', () => {
  // A source Zoho starts writing tomorrow must not join Direct quietly.
  assert.equal(leadSourceGroup('Platform'), 'other');
  assert.equal(leadSourceGroup('Excel CRM'), 'other');
  assert.equal(leadSourceGroup('Something Bespoke'), 'other');

  // No source is a real answer and keeps its own group — 104 leads, which a filter has
  // to be able to ask for.
  assert.equal(leadSourceGroup(null), 'unattributed');
  assert.equal(leadSourceGroup(''), 'unattributed');
  assert.equal(leadSourceGroup('   '), 'unattributed');
});

test('every group has a label, and the label survives the badge', () => {
  for (const s of LEAD_SOURCES) {
    assert.ok(s.label.trim(), `${s.key} has no label`);
  }
  // Rendered as given — SourceBadge no longer title-cases, so the internal capitals have
  // to be right here.
  assert.equal(leadSourceLabel('Incorporation LinkdIn'), 'LinkedIn');
  assert.equal(leadSourceLabel('WhatsApp - USAINDIACFO'), 'WhatsApp');
  assert.equal(leadSourceLabel('Canada Meta Ads'), 'Canada');
  assert.equal(leadSourceLabel(null), 'Unattributed');
});

test('an unfamiliar CRM string still reaches the channel its enum knows', () => {
  // Merging channelSlugFor into leadSourceGroup nearly lost this. The group rules are a
  // superset of the old channel rules but NOT of leadSourceType's, so a source neither
  // recognises by name — but the enum classifies — must still fall through to the switch.
  assert.equal(leadSourceGroup('Trade Show'), 'other');
  assert.equal(channelSlugFor('event', 'Trade Show'), 'events');
  assert.equal(channelSlugFor('website', 'Web Download'), 'direct');
  assert.equal(channelSlugFor('paid_ads', 'Some Brand New Campaign'), 'meta-ads');

  // ...and where the enum knows nothing either, nothing is invented.
  assert.equal(channelSlugFor('import', 'Something Bespoke'), null);
  assert.equal(channelSlugFor('manual', 'Something Bespoke'), null);
});

test('a lead this app created shows its own source, not "Unattributed"', () => {
  // Only Zoho writes sourceDetail. A lead from the New Lead button or from a website
  // posting to /api/public/v1/leads has none, and read "Unattributed" in the Source
  // column while carrying a real channel underneath.
  assert.equal(leadSourceLabel(null, 'form'), 'Form');
  assert.equal(leadSourceLabel(null, 'landing_page'), 'Landing page');
  assert.equal(leadSourceLabel(null, 'website'), 'Website');

  // The enum's own words for not knowing stay honest.
  assert.equal(leadSourceLabel(null, 'import'), 'Unattributed');
  assert.equal(leadSourceLabel(null, 'manual'), 'Unattributed');
  assert.equal(leadSourceLabel(null), 'Unattributed');

  // A CRM string always wins over the enum — 22,887 Zoho leads carry sourceType `import`.
  assert.equal(leadSourceLabel('ig', 'import'), 'Instagram');
  assert.equal(leadSourceLabel('Canada Meta Ads', 'paid_ads'), 'Canada');
});

// ─── the campaign the CRM's source string names ───────────────────────────────

test('leadCampaign reads the business line out of the source string', () => {
  // Zoho stamps no campaign and writes no UTM, so this string is the only campaign the
  // data contains. These are the real values, and the counts they carry are why it is
  // worth extracting: Incorporation is 3,871 leads and Trademark 2,852.
  assert.equal(leadCampaign('Incorporation LinkdIn'), 'Incorporation');
  assert.equal(leadCampaign('Incorporation Google Ads'), 'Incorporation');
  assert.equal(leadCampaign('Old Incorp LinkedIn'), 'Incorporation');
  assert.equal(leadCampaign('BNG US Incorp'), 'Incorporation');

  assert.equal(leadCampaign('Trademark Google Ads'), 'Trademark');
  assert.equal(leadCampaign('Trademark - Landingpage'), 'Trademark');
  assert.equal(leadCampaign('Trademark_Meta'), 'Trademark');

  assert.equal(leadCampaign('Canada Meta Ads'), 'Canada');
  assert.equal(leadCampaign('Hiring LinkedIn Ads'), 'Hiring');
  assert.equal(leadCampaign('Meta-VCFO'), 'VCFO');
  assert.equal(leadCampaign('VCFO linkdin'), 'VCFO');
  assert.equal(leadCampaign('IRS Google Ads'), 'IRS');
  assert.equal(leadCampaign('IRS LinkedIn Ads'), 'IRS');
});

test('a named event is its own campaign', () => {
  assert.equal(leadCampaign('Convergence India Expo 2026'), 'Convergence India Expo 2026');
  assert.equal(leadCampaign('Discovery Meet: AI Impact Summit'), 'AI Impact Summit');
  assert.equal(leadCampaign('Ambiente and Biofach Events'), 'Ambiente & Biofach');
  assert.equal(leadCampaign('BTS Event'), 'BTS Event');
});

test('leadCampaign says nothing where the CRM named no campaign', () => {
  // 19,753 leads. A channel or a person is not a campaign, and inventing one here would
  // put a campaign nobody ran into the column the marketing review reads.
  for (const v of ['fb', 'ig', 'Landing Page', 'Ref by NG', 'Whatsapp', 'Meta Ads', 'Call']) {
    assert.equal(leadCampaign(v), null, `${v} is not a campaign`);
  }
  assert.equal(leadCampaign(null), null);
  assert.equal(leadCampaign(''), null);

  // Whole word, so the first source that merely contains the letters does not become IRS.
  assert.equal(leadCampaign('First Contact'), null);
});

test('every campaign a source can name is offered by the filter', () => {
  // The filter's options come from LEAD_CAMPAIGNS; a line the mapping can return but the
  // list does not carry would be unselectable.
  const named = new Set<string>(LEAD_CAMPAIGNS);
  for (const v of [
    'Incorporation LinkdIn', 'Trademark Google Ads', 'Canada Meta Ads', 'Hiring LinkedIn Ads',
    'Meta-VCFO', 'IRS Google Ads', 'BTS Event', 'Convergence India Expo 2026',
    'Discovery Meet: AI Impact Summit', 'Ambiente and Biofach Events',
  ]) {
    const c = leadCampaign(v);
    assert.ok(c && named.has(c), `${v} -> ${c} is not in LEAD_CAMPAIGNS`);
  }
});
