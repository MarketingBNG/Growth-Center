import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleFindings } from '../lib/ai.ts';
import type { GrowthContext } from '../lib/ai.ts';

// A context with just enough on it to trigger each money-bearing finding. Cast because
// GrowthContext is inferred from a query and carries far more than these rules read.
const ctx = (currency: string): GrowthContext =>
  ({
    periodDays: 90,
    currency,
    current: { leads: 100, marketingSpend: 406737 },
    previousPeriod: { leads: 200, marketingSpend: 495808 },
    channels: [
      { name: 'Meta Ads', spend: 406737, revenue: 0, leads: 151, roas: null },
      { name: 'Referral', spend: 50000, revenue: 888900, leads: 13, roas: 17.8 },
    ],
    campaigns: [],
    openPipeline: { deals: 12, value: 2500000, weighted: 1200000 },
    leadsByStatus: { new: 40 },
  }) as unknown as GrowthContext;

// growthContext converts every figure into the workspace's reporting currency and states
// which one it is. These sentences printed a dollar sign onto it regardless, so a rupee
// workspace read "Meta Ads has spent $406,737" — the right number under a symbol that
// overstates it ninety-five-fold, in text a person is meant to act on.
test('rule findings print money in the reporting currency', () => {
  const text = ruleFindings(ctx('INR'))
    .map((f) => `${f.title} ${f.body}`)
    .join('\n');

  assert.ok(text.includes('₹406,737'), 'spend should carry the rupee symbol');
  assert.ok(text.includes('₹1,200,000'), 'weighted pipeline should carry it too');
  assert.ok(!text.includes('$'), `no dollar sign should survive:\n${text}`);
});

test('a dollar workspace still reads in dollars', () => {
  const text = ruleFindings(ctx('USD'))
    .map((f) => `${f.title} ${f.body}`)
    .join('\n');

  assert.ok(text.includes('$406,737'));
  assert.ok(!text.includes('₹'));
});

// The symbol has to follow the setting rather than a branch per known currency, so a
// third currency is not a code change.
test('an unmapped currency is named rather than given the wrong symbol', () => {
  const text = ruleFindings(ctx('AED'))
    .map((f) => `${f.title} ${f.body}`)
    .join('\n');

  assert.ok(text.includes('AED 406,737'));
  assert.ok(!text.includes('$'));
  assert.ok(!text.includes('₹'));
});
