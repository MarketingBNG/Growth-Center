// Exercises the Phase 3 read paths against the real database — the queries the
// dashboard, marketing, analytics and Integration Center pages run.

import { channelPerformance, funnel, kpis, openPipeline, rangeFor, trend } from '../lib/metrics.ts';
import { campaignPerformance, campaignTotals } from '../lib/campaigns.ts';
import { cards } from '../lib/integrations/service.ts';
import { db } from '../lib/prisma.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const failures: string[] = [];
function check(ok: boolean, message: string) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures.push(message);
}
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const { current } = rangeFor(365);

console.log('\nFunnel');
const f = await funnel(current);
console.log(`  ${f.visitors.toLocaleString('en-US')} visitors -> ${f.leads} leads -> ${f.qualified} qualified -> ${f.opportunities} opps -> ${f.customers} customers -> ${money(f.revenue)}`);
check(f.visitors > f.leads, 'the funnel narrows from visitors to leads');
check(f.leads >= f.qualified, 'qualified never exceeds leads');
check(f.revenue > 0 && f.spend > 0, 'revenue and spend are both present');
check(f.roas !== null && f.roas > 0, `ROAS is computable (${f.roas?.toFixed(2)}x)`);
check(f.newRevenue <= f.revenue, `new business (${money(f.newRevenue)}) does not exceed total revenue (${money(f.revenue)})`);
// ROAS must divide NEW business by spend. Recurring income from customers won earlier is
// not a return on this period's spend, and counting it gave an 18x blended figure.
check(
  Math.abs((f.roas ?? 0) - f.newRevenue / f.spend) < 0.01,
  'ROAS is new business over spend, not all revenue over spend',
);
check(f.cac !== null, `CAC is computable (${f.cac ? money(f.cac) : 'null'})`);

console.log('\nKPIs');
const { cards: cardList } = await kpis(30);
check(cardList.length === 10, `10 KPI cards (${cardList.length})`);
check(!!cardList.find((k) => k.key === 'newRevenue'), 'a New business card exists');
check(
  cardList.every((k) => k.value === null || Number.isFinite(k.value)),
  'no KPI value is NaN or Infinity',
);
const spendKpi = cardList.find((k) => k.key === 'spend');
check(spendKpi?.higherIsBetter === false, 'rising spend is not treated as a win');
const cacKpi = cardList.find((k) => k.key === 'cac');
check(cacKpi?.higherIsBetter === false, 'rising CAC is not treated as a win');

console.log('\nTrend series');
const daily = await trend(current, 'month');
check(daily.length > 1, `monthly buckets produced (${daily.length})`);
check(
  daily.every((d) => /^\d{4}-\d{2}$/.test(d.date)),
  'every monthly bucket key is YYYY-MM',
);
check(
  daily.every((d, i) => i === 0 || d.date > daily[i - 1].date),
  'buckets are sorted ascending',
);
const trendRevenue = daily.reduce((t, d) => t + d.revenue, 0);
check(
  Math.abs(trendRevenue - f.revenue) < 1,
  `trend revenue matches the funnel total (${money(trendRevenue)} vs ${money(f.revenue)})`,
);

console.log('\nPipeline');
const pipeline = await openPipeline();
check(pipeline.count > 0, `open deals (${pipeline.count})`);
check(pipeline.weighted <= pipeline.total, 'weighted value never exceeds total');

console.log('\nChannels');
const channels = await channelPerformance(current);
check(channels.length > 0, `channels returned (${channels.length})`);
check(
  channels.every((c) => c.roas === null || c.spend > 0),
  'ROAS is null wherever nothing was spent, never Infinity',
);
check(
  channels.every((c) => c.cac === null || c.customers > 0),
  'CAC is null wherever nothing was won',
);
const channelRevenue = channels.reduce((t, c) => t + c.revenue, 0);
check(channelRevenue <= f.revenue + 1, 'channel revenue does not exceed total revenue');

console.log('\nCampaigns');
const campaigns = await campaignPerformance(current);
const totals = campaignTotals(campaigns);
check(campaigns.length > 0, `campaigns returned (${campaigns.length})`);
check(
  Math.abs(totals.spend - f.spend) < 1,
  `campaign spend total matches the funnel (${money(totals.spend)} vs ${money(f.spend)})`,
);
// The footer must be recomputed from totals, not averaged from the rows.
const naiveCtr =
  campaigns.filter((c) => c.ctr !== null).reduce((t, c) => t + (c.ctr ?? 0), 0) /
  Math.max(1, campaigns.filter((c) => c.ctr !== null).length);
check(
  totals.ctr !== null && Math.abs(totals.ctr - naiveCtr) > 0.0001,
  `footer CTR is recomputed (${totals.ctr?.toFixed(3)}%), not the row average (${naiveCtr.toFixed(3)}%)`,
);
check(
  campaigns.every((c) => c.ctr === null || (c.ctr >= 0 && c.ctr <= 100)),
  'every CTR is a sane percentage',
);

console.log('\nIntegrations');
const list = await cards();
check(list.length === 4, `4 providers registered (${list.length})`);
check(
  list.every((c) => c.state !== 'connected' || c.hasCredential),
  'no card reports connected without a stored credential',
);
check(
  list.filter((c) => c.state === 'demo_data').length > 0,
  `some providers are honestly labelled demo_data (${list.filter((c) => c.state === 'demo_data').length})`,
);
for (const c of list) {
  console.log(`   · ${c.name.padEnd(20)} ${c.state.padEnd(13)} configured=${c.configured} missingEnv=${c.missingEnv.length}`);
}
check(
  list.every((c) => !c.configured || c.missingEnv.length === 0),
  'a provider is only "configured" when nothing is missing',
);

await db().$disconnect();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
