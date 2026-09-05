import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerId, describeError, fromMicros, googleAds } from '../lib/integrations/providers/google-ads.ts';
import { linkedinAds, readDate, readMoney, urnId } from '../lib/integrations/providers/linkedin-ads.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// ── Google Ads ───────────────────────────────────────────────────────────────────────

// Micros are Google's unit for money: 1,000,000 is one unit of the account's currency.
// Stored raw, a ₹450 day would go on record as ₹450,000,000 — and spend feeds CAC, ROAS
// and budget pacing, so the error would surface as four wrong numbers, not one.
test('money is converted out of micros', () => {
  assert.equal(fromMicros(450_000_000), 450);
  assert.equal(fromMicros('1500000'), 1.5);
  assert.equal(fromMicros(0), 0);
  // Absent cost is zero spend, not NaN — Google omits the field on a day with no cost.
  assert.equal(fromMicros(undefined), 0);
  assert.equal(fromMicros(null), 0);
});

test('a customer ID is reduced to digits, and the form refuses anything else', () => {
  assert.equal(customerId('123-456-7890'), '1234567890');
  assert.equal(customerId('1234567890'), '1234567890');

  const normalise = googleAds.configFields?.find((f) => f.name === 'customerId')?.normalise;
  assert.ok(normalise);
  assert.equal(normalise('123-456-7890'), '1234567890');
  // Ten digits is the whole validation: a nine-digit paste is the commonest typo and
  // fails at the API with an error that does not say so.
  assert.throws(() => normalise('123456789'), /ten digits/);
  assert.throws(() => normalise(''), /ten digits/);

  // The manager field is optional, and blank must stay blank rather than becoming "0".
  const manager = googleAds.configFields?.find((f) => f.name === 'loginCustomerId')?.normalise;
  assert.equal(manager?.(''), '');
  assert.equal(manager?.('123-456-7890'), '1234567890');
});

// A developer token with Test Account access only is the commonest reason a first sync
// fails, and Google buries it in a nested error array that reads as a generic permission
// problem. Reported as itself, so nobody goes looking at the OAuth.
test('a test-only developer token is named rather than reported as a permission error', () => {
  const body = '{"error":{"details":[{"errors":[{"errorCode":{"authorizationError":"DEVELOPER_TOKEN_NOT_APPROVED"}}]}]}}';
  assert.match(describeError(403, body), /Basic access/);

  assert.match(describeError(403, '{"errors":[{"errorCode":{"authorizationError":"USER_PERMISSION_DENIED"}}]}'), /no access/);
  assert.match(describeError(403, 'CUSTOMER_NOT_FOUND'), /customer ID/);
  assert.match(describeError(401, ''), /Reconnect/);
  assert.match(describeError(429, ''), /rate-limiting/);
});

test('Google Ads declares the channel its campaigns belong to', () => {
  // Without this the sync stores metrics and materialises no campaigns, leaving the
  // marketing tables empty — the failure Meta Ads shipped with once.
  assert.deepEqual(googleAds.channel, { slug: 'google-ads', name: 'Google Ads', kind: 'paid' });
  assert.equal(getProvider('google_ads')?.name, 'Google Ads');
});

test('Google Ads will not claim to be configured without a developer token', () => {
  assert.ok(googleAds.requiredEnv.some((e) => e.name === 'GOOGLE_ADS_DEVELOPER_TOKEN'));
});

// ── LinkedIn Ads ─────────────────────────────────────────────────────────────────────

test('a URN is reduced to its id', () => {
  assert.equal(urnId('urn:li:sponsoredCampaign:123456'), '123456');
  assert.equal(urnId('urn:li:sponsoredAccount:512345678'), '512345678');
  assert.equal(urnId('123456'), '123456');
  // A URN whose tail is not numeric is not an id, and must not be stored as one.
  assert.equal(urnId('urn:li:organization:abc'), null);
  assert.equal(urnId(undefined), null);
});

// A partial date silently becoming today would attribute last month's spend to this
// morning — and spend is what CAC and pacing are computed from.
test('an incomplete LinkedIn date is refused rather than guessed', () => {
  assert.equal(readDate({ year: 2026, month: 9, day: 1 })?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(readDate({ year: 2026, month: 9 }), null);
  assert.equal(readDate({}), null);
  assert.equal(readDate(undefined), null);
});

test('cost arrives as a string beside its currency and both are kept', () => {
  assert.deepEqual(readMoney({ amount: '12.34', currencyCode: 'USD' }), { amount: 12.34, currency: 'USD' });
  // Currency matters: this workspace mixes INR and USD, and pacing divides a budget by
  // spend, so the two have to agree.
  assert.deepEqual(readMoney({ amount: '0' }), { amount: 0, currency: null });
  assert.deepEqual(readMoney(undefined), { amount: 0, currency: null });
});

// The repository had two names for this channel — `linkedin_ads` in resolveCampaign and
// `linkedin` in the badge metadata — and an unknown id degrades silently rather than
// failing. The provider takes the id that routes data.
test('the provider id matches the slug resolveCampaign already expects', () => {
  assert.equal(linkedinAds.id, 'linkedin_ads');
  assert.equal(getProvider('linkedin_ads')?.name, 'LinkedIn Ads');
  assert.deepEqual(linkedinAds.channel, { slug: 'linkedin-ads', name: 'LinkedIn Ads', kind: 'paid' });
});

test('an ad account accepts digits or a URN and refuses prose', () => {
  const normalise = linkedinAds.configFields?.find((f) => f.name === 'adAccountId')?.normalise;
  assert.ok(normalise);
  assert.equal(normalise('512345678'), '512345678');
  assert.equal(normalise('urn:li:sponsoredAccount:512345678'), '512345678');
  assert.equal(normalise(''), '', 'blank means "the only account there is"');
  assert.throws(() => normalise('USA India CFO'));
});
