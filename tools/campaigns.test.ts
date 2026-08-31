import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignTotals } from '../lib/campaigns.ts';
import type { CampaignRow } from '../lib/campaigns.ts';

const row = (over: Partial<CampaignRow>): CampaignRow =>
  ({
    id: 'c1', name: 'Campaign', status: 'active', source: 'meta_ads',
    channelId: 'ch1', channelName: 'Meta Ads', channelKind: 'paid',
    spend: 0, impressions: 0, clicks: 0,
    leads: 0, opportunities: 0, customers: 0, revenue: 0,
    ctr: null, clickToLead: null, costPerLead: null, cac: null, roas: null,
    ...over,
  }) as CampaignRow;

// Zoho stamps no campaign on a lead, deal or payment, so those columns are unknown rather
// than zero and campaignPerformance returns null. Summed with `?? 0` the footer came back
// as a confident 0 under a column of dashes.
test('an untracked column stays untracked in the footer', () => {
  const t = campaignTotals([
    row({ spend: 1000, impressions: 500, clicks: 20, leads: null, opportunities: null, customers: null, revenue: null }),
    row({ spend: 500, impressions: 250, clicks: 10, leads: null, opportunities: null, customers: null, revenue: null }),
  ]);

  assert.equal(t.spend, 1500);
  assert.equal(t.impressions, 750);
  assert.equal(t.clicks, 30);
  assert.equal(t.leads, null);
  assert.equal(t.revenue, null);
  // Nothing derived from an unknown may present itself as known.
  assert.equal(t.costPerLead, null);
  assert.equal(t.cac, null);
  assert.equal(t.roas, null);
  // Delivery is reported per campaign, so its ratio survives.
  assert.equal(t.ctr, 4);
});

test('tracked columns still total normally', () => {
  const t = campaignTotals([
    row({ spend: 1000, clicks: 20, leads: 5, opportunities: 2, customers: 1, revenue: 4000 }),
    row({ spend: 1000, clicks: 20, leads: 5, opportunities: 2, customers: 1, revenue: 2000 }),
  ]);

  assert.equal(t.leads, 10);
  assert.equal(t.revenue, 6000);
  assert.equal(t.roas, 3);
  assert.equal(t.cac, 1000);
  assert.equal(t.costPerLead, 200);
});

// A partly-attributed workspace must not present a total that silently omits the rows it
// could not read — that is the understatement the channel-spend warning already guards.
test('one unknown row makes the column unknown, not a partial sum', () => {
  const t = campaignTotals([
    row({ spend: 1000, leads: 5 }),
    row({ spend: 1000, leads: null }),
  ]);
  assert.equal(t.leads, null);
});
