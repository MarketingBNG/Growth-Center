import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACQUISITION_CAMPAIGN,
  isAcquisition,
  resolveObjective,
} from '../lib/campaign-objective.ts';

// The five campaigns this account actually runs recruitment through, by name, verbatim
// from the database. ₹395,505 of lifetime spend sat in the denominator of CPL, CAC and
// ROAS because none of them were distinguishable from lead generation.
test('this account\u2019s real hiring campaigns are classified as hiring', () => {
  for (const name of [
    'USAIndiaCFO_Hiring_VirtualCFO_Ajmer',
    'UIC | Leads | Hiring | Virtual CFO Associate',
    'Hiring | Manager | Ajmer',
    'Hiring | CA Articles | Ajmer',
    'JAIPUR - HIRING - AUG 2026',
  ]) {
    assert.equal(resolveObjective({ name }), 'hiring', name);
  }
});

// The other forty. A false positive here is worse than a false negative: it removes real
// acquisition spend from the denominator and flatters every ratio on the Marketing page.
test('the lead-generation campaigns are not swept up with them', () => {
  for (const name of [
    'USAIndiaCFO_CustomAudience',
    'USAIndiaCFO_LookALikeAudience',
    'Leads_CanadaSetup_IndianFounders_July2026',
    'Whatsapp Leads Campaign 6-nov-2025',
    'BengaluruTechSummit_Awareness_15Nov25',
    'Biofach_LeadGenCamapign_Feb26',
    'AmitWebinar_April26_New',
  ]) {
    assert.notEqual(resolveObjective({ name }), 'hiring', name);
  }
});

// Meta requires an advertiser to declare an employment ad, so the declaration is
// structured data and outranks everything else — including a name that says nothing.
test('Meta\u2019s employment declaration settles it on its own', () => {
  assert.equal(
    resolveObjective({ name: 'Q3 Push', specialCategories: ['EMPLOYMENT'], platformObjective: 'OUTCOME_LEADS' }),
    'hiring',
  );
  assert.equal(resolveObjective({ specialCategories: ['employment'] }), 'hiring', 'case-insensitive');
  assert.equal(resolveObjective({ specialCategories: ['CREDIT'], name: 'Q3 Push' }), 'other');
});

// A hiring campaign is generating leads — they are simply applicants. Reading the
// objective before the name would classify every campaign above as acquisition, which is
// the bug in the first place.
test('the name outranks a lead-generation objective', () => {
  assert.equal(resolveObjective({ name: 'Hiring | Manager', platformObjective: 'OUTCOME_LEADS' }), 'hiring');
});

test('awareness objectives are separated from acquisition ones', () => {
  assert.equal(resolveObjective({ platformObjective: 'OUTCOME_AWARENESS' }), 'awareness');
  assert.equal(resolveObjective({ platformObjective: 'VIDEO_VIEWS' }), 'awareness');
  assert.equal(resolveObjective({ platformObjective: 'OUTCOME_LEADS' }), 'acquisition');
  assert.equal(resolveObjective({ platformObjective: 'outcome_sales' }), 'acquisition');
});

// An objective nobody recognises must overstate cost rather than understate it: guessing
// a campaign is *not* acquisition silently shrinks the denominator.
test('an unrecognised campaign still counts against acquisition', () => {
  assert.equal(resolveObjective({ platformObjective: 'SOMETHING_NEW' }), 'other');
  assert.equal(resolveObjective({}), 'other');
  assert.ok(isAcquisition('other'));
  assert.ok(isAcquisition(null), 'a campaign nothing has classified counts as it always did');
  assert.ok(isAcquisition(undefined));
  assert.ok(isAcquisition('acquisition'));
  assert.equal(isAcquisition('hiring'), false);
  assert.equal(isAcquisition('awareness'), false);
});

// Null being included is what makes the migration safe to deploy ahead of the backfill:
// until a row is classified it counts exactly as it did before the column existed, so
// shipping the schema alone cannot move a figure on a screen.
test('the query filter admits unclassified campaigns', () => {
  assert.deepEqual(ACQUISITION_CAMPAIGN.OR[0], { objective: null });
  assert.deepEqual(ACQUISITION_CAMPAIGN.OR[1], { objective: { in: ['acquisition', 'other'] } });
});
