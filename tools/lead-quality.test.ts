import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadStatement, segmentOf, segmentLabel } from '../lib/lead-segment.ts';
import { lostReasonOf, lostReasonLabel } from '../lib/lead-lost-reason.ts';
import { SCORE_VERSION, scoreBand, scoreLead } from '../lib/lead-score.ts';
import { inheritedConfidence, resolveAttribution } from '../lib/attribution-confidence.ts';

// ── §7.4 segment ─────────────────────────────────────────────────────────────────────

// The exact answers this account's Meta lead forms produce, copied from the live
// database. Zoho has no segment field, so these strings are the only evidence there is.
test('the lead-form answers map onto the ICP segments', () => {
  assert.equal(
    segmentOf('I run a funded startup in IndiaTo serve US clients under a US entityDelaware (Most popular for startups)'),
    'indian_founded_us_entity',
  );
  assert.equal(
    segmentOf('I run a profitable bootstrapped company in IndiaOtherNew York'),
    'indian_founded_us_entity',
  );
  assert.equal(
    segmentOf('Indian founder planning Canada expansionNew company incorporationImmediately'),
    'canada_expansion',
  );
  assert.equal(segmentOf('I’m just exploring the US market for nowOtherOther'), 'indian_sme_us_entry');
  assert.equal(
    segmentOf('I’m an investor or HNWI planning a US expansionTo raise venture capital or attract investorsDelaware (Most popular for startups)'),
    'nri_hni',
  );
});

// "Indian founder planning Canada expansion" contains neither "startup" nor "exploring",
// but a shorter pattern reached first would still claim a message a longer one describes
// better. The list is ordered by specificity for the same reason crm-mapping.ts is.
test('the most specific answer wins', () => {
  assert.equal(
    segmentOf('Indian founder planning Canada expansionBusiness expansionWithin 30 days'),
    'canada_expansion',
  );
});

// 22,914 leads carry no message at all. Inventing a segment for them would put four
// fifths of the lead base into whichever bucket the fallback chose.
test('a lead that said nothing has no segment', () => {
  assert.equal(segmentOf(null), null);
  assert.equal(segmentOf(''), null);
  assert.equal(segmentOf('yes'), null);
  assert.equal(segmentLabel(null), 'Unsegmented');
});

// `Lead.message` holds three different things, and 694 leads carry the outbound broadcast
// that was sent to them rather than anything they said. That ad copy contains "company
// registration" and every state name the intent rules look for.
test('outbound ad copy is not read as the lead speaking', () => {
  const broadcast =
    'Launch your US business from India — fully online ??\nSet up your US LLC with EIN & Bank Account.\n✔ No travel required';
  assert.equal(leadStatement(broadcast), null);
  assert.equal(segmentOf(broadcast), null);
  assert.equal(scoreLead({ message: broadcast }).components.find((c) => c.key === 'intent')?.points, 0);

  // A form answer is one line and survives.
  assert.equal(leadStatement('Company registration in U.S.Access to the US market'), 'Company registration in U.S.Access to the US market');
});

// ── §7.6 lost reason ─────────────────────────────────────────────────────────────────

// This organisation's Zoho Lead_Status picklist is already doing the job of a lost-reason
// field, and the sync stores it verbatim.
test('the CRM’s own status words become the taxonomy', () => {
  assert.equal(lostReasonOf({ status: 'lost', sourceStatus: 'Not Reachable' }), 'no_response');
  // 116 job applicants were sitting in the lead base being counted as leads the marketing
  // spend had failed to convert.
  assert.equal(lostReasonOf({ status: 'unqualified', sourceStatus: 'Looking For Job' }), 'not_icp');
});

// "Dead Lead" says the lead is dead and does not say why. Mapping 9,867 of those onto one
// of the six named reasons would manufacture the concentration the insight looks for.
test('a lost lead that says nothing is unstated, not guessed', () => {
  assert.equal(lostReasonOf({ status: 'lost', sourceStatus: 'Dead Lead' }), 'unstated');
  assert.equal(lostReasonOf({ status: 'lost', sourceStatus: 'Lead Lost' }), 'unstated');
  assert.equal(lostReasonOf({ status: 'lost', sourceStatus: null }), 'unstated');
  assert.equal(lostReasonLabel('unstated'), 'No reason given');
});

test('a lead that is not lost has no lost reason at all', () => {
  assert.equal(lostReasonOf({ status: 'contacted', sourceStatus: 'Not Reachable' }), null);
  assert.equal(lostReasonOf({ status: 'converted', sourceStatus: 'Dead Lead' }), null);
  assert.equal(lostReasonOf({ status: 'new', sourceStatus: 'Untouched Lead' }), null);
});

// An owner's note is where the real reason lives when the picklist gives none, and it is
// read second so a chosen picklist value always wins over typed prose.
test('the picklist outranks the note', () => {
  assert.equal(
    lostReasonOf({ status: 'lost', sourceStatus: 'Not Reachable', message: 'went with a cheaper firm' }),
    'no_response',
  );
  assert.equal(
    lostReasonOf({ status: 'lost', sourceStatus: 'Dead Lead', message: 'Client said the price is too expensive' }),
    'price',
  );
});

// ── §7.3 score ───────────────────────────────────────────────────────────────────────

// "Score is reproducible from raw fields and is unit-tested." Same record in, same number
// out, no clock and no database — which is also what makes today's score comparable to
// the score of a lead from April.
test('the score is a pure function of the record', () => {
  const record = {
    channelSlug: 'referral',
    email: 'priya@acme.co.in',
    phone: '+919812345678',
    message: 'I run a funded startup in IndiaTo serve US clients under a US entityImmediately',
  };
  const first = scoreLead(record);
  const second = scoreLead(record);
  assert.equal(first.total, second.total);
  // 25 source + 20 domain + 10 phone + 25 segment + 20 intent.
  assert.equal(first.total, 100);
  assert.equal(first.version, SCORE_VERSION);
});

test('the worst possible lead scores zero rather than going negative', () => {
  const worst = scoreLead({});
  assert.equal(worst.total, 0);
  assert.equal(scoreBand(worst.total), 'cold');
});

// A free provider tells you nothing about a company, and 19,734 of this account's leads
// use gmail.com — so this component is the one that separates the small minority who
// wrote from a business.
test('a personal email earns nothing and a company domain earns the points', () => {
  const personal = scoreLead({ email: 'someone@gmail.com' });
  const company = scoreLead({ email: 'someone@acme.com' });
  const domain = (s: ReturnType<typeof scoreLead>) => s.components.find((c) => c.key === 'domain');
  assert.equal(domain(personal)?.points, 0);
  assert.equal(domain(company)?.points, 20);
  assert.match(domain(personal)?.detail ?? '', /personal email/);
});

// `Channel` is a table, so slugs arrive from the CRM without a deploy. Scoring an unknown
// one as zero would rank every new source below the worst one ever measured.
test('an unrecognised channel scores as unknown, not as bad', () => {
  const unknown = scoreLead({ channelSlug: 'some-new-source' });
  const source = unknown.components.find((c) => c.key === 'source');
  assert.equal(source?.points, 10);
  assert.match(source?.detail ?? '', /no measured tier/);

  // No channel at all is genuinely nothing to rank, and does score zero.
  assert.equal(scoreLead({}).components.find((c) => c.key === 'source')?.points, 0);
});

// Every component is named and carries its own reason, because the point of a
// deterministic score is that somebody can disagree with one part of it.
test('every component explains itself and the weights sum to 100', () => {
  const scored = scoreLead({ channelSlug: 'facebook' });
  assert.equal(scored.components.reduce((sum, c) => sum + c.max, 0), 100);
  for (const c of scored.components) {
    assert.ok(c.detail.length > 0, `${c.key} has no explanation`);
    assert.ok(c.points <= c.max, `${c.key} scored above its own maximum`);
  }
});

test('the bands cut where the filters do', () => {
  assert.equal(scoreBand(60), 'hot');
  assert.equal(scoreBand(59), 'warm');
  assert.equal(scoreBand(35), 'warm');
  assert.equal(scoreBand(34), 'cold');
});

// ── G1.2 attribution confidence ──────────────────────────────────────────────────────

test('a recognised source string is reported, and nothing at all is none', () => {
  assert.equal(resolveAttribution('social', 'fb').confidence, 'reported');
  assert.equal(resolveAttribution('referral', 'Ref by NG').confidence, 'reported');
  assert.equal(resolveAttribution('import', null).confidence, 'none');
});

// A deal whose channel came from a lead's channel is one step removed, and revenue
// attribution — 10.2%, the figure qualifying every channel ranking in the app — is
// exactly where that matters.
test('an inherited channel is weaker than a stated one', () => {
  assert.equal(inheritedConfidence('reported'), 'inferred');
  assert.equal(inheritedConfidence('inferred'), 'none');
  assert.equal(inheritedConfidence(null), 'none');
});
