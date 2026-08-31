// Exercises the Phase 3 read paths against the real database — the queries the
// dashboard, marketing, analytics and Integration Center pages run.

import {
  accountMetrics,
  analyticsKpis,
  avgCycleDays,
  budgetPacing,
  channelPerformance,
  crmKpis,
  customerShare,
  duplicatesMerged,
  funnel,
  kpis,
  leadsByWeekday,
  leadsKpis,
  marketingKpis,
  medianResponseHours,
  openPipeline,
  pipelineKpis,
  rangeFor,
  trend,
  unassignedLeads,
  winRate,
} from '../lib/metrics.ts';
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
// Non-null, not necessarily above zero: a period where the paid channels booked nothing
// has an honest ROAS of 0x, and asserting otherwise would demand the figure be flattering.
check(f.roas !== null, `ROAS is computable (${f.roas?.toFixed(2)}x)`);
check(f.newRevenue <= f.revenue, `new business (${money(f.newRevenue)}) does not exceed total revenue (${money(f.revenue)})`);
check(
  f.paidRevenue <= f.newRevenue,
  `paid-channel new business (${money(f.paidRevenue)}) does not exceed all new business (${money(f.newRevenue)})`,
);
check(
  f.paidCustomers <= f.customers,
  `paid-channel customers (${f.paidCustomers}) do not exceed all new customers (${f.customers})`,
);
// ROAS divides the new business booked against a PAID channel by spend. Two earlier
// definitions were both wrong here: all revenue over spend (18x), then all new business
// over spend (225x) - on an account that books 94% of its money against no channel.
check(
  Math.abs((f.roas ?? 0) - f.paidRevenue / f.spend) < 0.01,
  'ROAS is paid-channel new business over spend, not the whole business over spend',
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

// ─── Phase 4 redesign: the analytics band's new figures ───────────────────────

console.log('\nOperational metrics');
const [median, unassigned, dupes, wins, cycle, weekday, accounts, share, pacing] = await Promise.all([
  medianResponseHours(current),
  unassignedLeads(current),
  duplicatesMerged(current),
  winRate(current),
  avgCycleDays(current),
  leadsByWeekday(current),
  accountMetrics(current),
  customerShare(),
  budgetPacing(current),
]);

console.log(`  median response: ${median === null ? 'null' : median.toFixed(2) + 'h'}`);
check(median === null || median >= 0, 'median response is null or non-negative, never negative');

console.log(`  unassigned leads: ${unassigned}`);
check(unassigned >= 0 && unassigned <= f.leads, `unassigned (${unassigned}) never exceeds leads (${f.leads})`);

console.log(`  duplicates merged: ${dupes}`);
check(dupes >= 0, 'duplicates merged is non-negative');

console.log(`  win rate: ${wins === null ? 'null (no decided deals)' : wins.toFixed(1) + '%'}`);
check(wins === null || (wins >= 0 && wins <= 100), 'win rate is null or a real percentage');

console.log(`  avg cycle: ${cycle === null ? 'null (nothing won)' : cycle.toFixed(1) + ' days'}`);
check(cycle === null || cycle >= 0, 'avg cycle is null or non-negative');

const weekdayTotal = weekday.reduce((a, b) => a + b.value, 0);
console.log(`  weekday split: ${weekday.map((w) => `${w.label} ${w.value}`).join(' · ')}`);
check(weekday.length === 7, 'the weekday chart gets exactly seven buckets');
check(weekdayTotal === f.leads, `weekday buckets sum to the lead count (${weekdayTotal} vs ${f.leads})`);

console.log(`  accounts: ${accounts.companies} companies, ${accounts.contacts} contacts, ${accounts.customers} won, avg ${accounts.avgAccountValue === null ? 'null' : money(accounts.avgAccountValue)} over ${accounts.payingAccounts} paying`);
check(
  accounts.avgAccountValue === null || accounts.payingAccounts > 0,
  'an average account value is only reported when an account actually billed',
);

console.log(`  customer share: ${share === null ? 'null' : share.toFixed(1) + '%'}`);
check(share === null || (share >= 0 && share <= 100), 'customer share is null or a real percentage');

console.log(`  budget pacing: ${pacing === null ? 'null (no campaign budgets)' : pacing.toFixed(1) + '%'}`);
check(pacing === null || pacing >= 0, 'budget pacing is null or non-negative');

// The invariant the blended definition broke: Reports printed a 225x headline ROAS
// directly above a channel table whose only paid row said 0.00x. Whatever the headline
// claims, it cannot beat the best return any single paid channel actually earned.
console.log('\nHeadline ROAS against the channel table');
const paidRows = (await channelPerformance(current)).filter((c) => c.spend > 0);
const bestChannelRoas = Math.max(0, ...paidRows.map((c) => c.roas ?? 0));
console.log(`  headline ${f.roas?.toFixed(2)}x - best paid channel ${bestChannelRoas.toFixed(2)}x (${paidRows.length} paid channel(s))`);
check(
  (f.roas ?? 0) <= bestChannelRoas + 0.01,
  'the headline ROAS does not beat the best return any paid channel earned',
);

console.log('\nPer-screen KPI sets');
const sets = {
  leads: (await leadsKpis(365)).cards,
  crm: (await crmKpis(365)).cards,
  pipeline: (await pipelineKpis(365)).cards,
  marketing: (await marketingKpis(365)).cards,
  analytics: (await analyticsKpis(365)).cards,
};
for (const [name, set] of Object.entries(sets)) {
  console.log(`  ${name.padEnd(10)} ${set.map((c) => c.label).join(' · ')}`);
  check(set.length === 5, `${name} yields exactly five cards`);
  check(
    set.every((c) => c.value === null || Number.isFinite(c.value)),
    `${name} produces no NaN or Infinity values`,
  );
  check(
    new Set(set.map((c) => c.key)).size === set.length,
    `${name} card keys are unique (React needs them stable)`,
  );
}

await db().$disconnect();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
