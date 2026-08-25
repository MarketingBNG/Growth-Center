// Reconciliation check for the demo dataset. Run after npm run db:seed.
//
// The seed's whole claim is that no two pages can disagree, because revenue is derived
// from won opportunities which are derived from converted leads. This asserts that
// chain against the database rather than trusting the generator.
//
//   DATABASE_URL=… node --experimental-strip-types tools/verify-seed.ts

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

const problems: string[] = [];
function check(ok: boolean, message: string) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) problems.push(message);
}

const leadsByStatus = await db.lead.groupBy({ by: ['status'], _count: { _all: true } });
const stages = await db.pipelineStage.findMany({
  orderBy: { position: 'asc' },
  include: { _count: { select: { opportunities: true } } },
});

console.log('\nLeads by status');
for (const r of leadsByStatus) console.log(`  ${r.status.padEnd(12)} ${r._count._all}`);

console.log('\nPipeline stages');
for (const s of stages) console.log(`  ${s.name.padEnd(12)} ${s._count.opportunities}`);

const wonStage = stages.find((s) => s.isWon);
if (!wonStage) {
  console.error('\nNo won stage exists — the pipeline was not seeded.');
  process.exit(1);
}

const [totalOpps, oppsWithCompany, wonOpps, oneTime, recurring, customers, sessions, spend] =
  await Promise.all([
    db.opportunity.count(),
    db.opportunity.count({ where: { companyId: { not: null } } }),
    db.opportunity.findMany({
      where: { stageId: wonStage.id },
      select: { id: true, value: true, companyId: true },
    }),
    db.revenueEntry.findMany({ where: { kind: 'one_time' }, select: { opportunityId: true, amount: true } }),
    db.revenueEntry.aggregate({ where: { kind: 'recurring' }, _sum: { amount: true }, _count: { _all: true } }),
    db.customer.count(),
    db.metricSnapshot.aggregate({ where: { metricKey: 'sessions' }, _sum: { value: true } }),
    db.marketingSpend.aggregate({ _sum: { amount: true } }),
  ]);

const wonValue = wonOpps.reduce((t, o) => t + Number(o.value), 0);
const oneTimeValue = oneTime.reduce((t, r) => t + Number(r.amount), 0);
const recurringValue = Number(recurring._sum.amount ?? 0);
const totalRevenue = oneTimeValue + recurringValue;
const totalSpend = Number(spend._sum.amount ?? 0);
const totalSessions = Number(sessions._sum.value ?? 0);
const leads = leadsByStatus.reduce((t, r) => t + r._count._all, 0);

console.log('\nReconciliation');
check(oppsWithCompany === totalOpps, `every opportunity has a company (${oppsWithCompany}/${totalOpps})`);
check(
  wonOpps.every((o) => o.companyId),
  'every won deal has a company, so it can produce a customer and revenue',
);
check(
  oneTime.length === wonOpps.length,
  `one one_time revenue row per won deal (${oneTime.length} rows, ${wonOpps.length} won)`,
);
check(
  Math.abs(wonValue - oneTimeValue) < 0.01,
  `won deal value equals one_time revenue (${money(wonValue)} vs ${money(oneTimeValue)})`,
);
check(customers > 0 && customers <= wonOpps.length, `customers (${customers}) do not exceed won deals (${wonOpps.length})`);
check(totalSessions > leads, `sessions (${totalSessions.toLocaleString('en-US')}) exceed leads (${leads}) — the funnel narrows`);
check(totalRevenue > 0 && totalSpend > 0, 'both revenue and spend are non-zero, so ROAS is computable');

const connected = await db.integration.count({ where: { state: 'connected' } });
check(connected === 0, `no integration claims to be connected (${connected})`);

const fakeAi = await db.aiInsight.count({ where: { provider: { not: 'seed' } } });
check(fakeAi === 0, `no seeded insight claims a real AI provider (${fakeAi})`);

console.log('\nTotals');
console.log(`  sessions      ${totalSessions.toLocaleString('en-US')}`);
console.log(`  leads         ${leads}`);
console.log(`  opportunities ${totalOpps} (${wonOpps.length} won)`);
console.log(`  customers     ${customers}`);
console.log(`  revenue       ${money(totalRevenue)}  (${money(oneTimeValue)} new + ${money(recurringValue)} recurring)`);
console.log(`  spend         ${money(totalSpend)}`);
console.log(`  blended ROAS  ${(totalRevenue / totalSpend).toFixed(2)}x`);
console.log(`  CAC           ${money(Math.round(totalSpend / customers))}`);

await db.$disconnect();

if (problems.length) {
  console.error(`\n${problems.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
