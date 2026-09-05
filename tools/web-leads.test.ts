import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEB_ARRIVING_CHANNELS, WEB_ARRIVING_LEAD, WEB_LEAD_BASIS, arrivesOnSite } from '../lib/web-leads.ts';

// The four channels that account for 12,614 of this workspace's 15,830 annual leads. All
// four are in-platform forms or chat threads: the person never loads a page on
// usaindiacfo.com, so GA4 never records a session for them. Counting them against site
// sessions credited the website with visits it never had.
test('leads filled inside a platform are not website conversions', () => {
  for (const slug of ['facebook', 'instagram', 'linkedin', 'whatsapp', 'meta-ads', 'canada']) {
    assert.equal(arrivesOnSite(slug), false, slug);
  }
});

test('the channels that do land on the site are counted', () => {
  for (const slug of ['landing-page', 'direct', 'organic-search', 'google-ads', 'email']) {
    assert.ok(arrivesOnSite(slug), slug);
  }
});

// `organic-search` has produced no leads at all yet. It is on the list anyway so the rate
// is right on the first day SEO produces one, rather than quietly wrong until somebody
// notices.
test('organic search is admitted before it has produced anything', () => {
  assert.ok(WEB_ARRIVING_CHANNELS.includes('organic-search'));
});

// "Ref by NG" is a person recommending the firm. An HTTP referrer is a page. They share a
// word and nothing else, and treating the first as the second is how 217 leads would have
// been credited to the website.
test('a human referral is not an HTTP referrer', () => {
  assert.equal(arrivesOnSite('referral'), false);
});

// `incorp` is BNG US Incorp — a different property, absent from this GA4 account. Its 933
// leads have a real website behind them; not this one.
test('a second property is not this property', () => {
  assert.equal(arrivesOnSite('incorp'), false);
});

// An allowlist, and the direction matters. Channel is a table, so slugs arrive from the
// CRM without a deploy; an unknown one is left out, which understates the rate. Claiming
// the site converted a lead that never saw it is the error being fixed.
test('an unrecognised channel is excluded rather than assumed', () => {
  assert.equal(arrivesOnSite('some-new-crm-value'), false);
  assert.equal(arrivesOnSite(null), false);
  assert.equal(arrivesOnSite(undefined), false);
  assert.equal(arrivesOnSite(''), false);
});

test('the query filter matches the list, and says so to the reader', () => {
  assert.deepEqual(WEB_ARRIVING_LEAD.channel.is.slug.in, [...WEB_ARRIVING_CHANNELS]);
  // The number is unreadable without its basis: 0.6% looks like a catastrophe beside a
  // 24.1% that was measuring something else entirely.
  assert.match(WEB_LEAD_BASIS, /never reach the website/);
});
