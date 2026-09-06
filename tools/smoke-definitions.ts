// K2's acceptance test: the definitions, recomputed by hand, against what the app reports.
//
// "Recomputed CPQL for a sample week matches a manual calculation." Not a unit test —
// tools/definitions.test.ts checks the predicates are one implementation each, which is a
// question about the source. This is the other question: does the number the dashboard
// shows survive being worked out independently, in SQL, against the live database.
//
// Run:  npm run smoke:definitions
//
// ── One trap, written down because it cost half an hour ───────────────────────────────
//
// `wonAt` and `createdAt` are naive `timestamp` columns. Handing `pg` a JavaScript Date
// sends it with this machine's offset — +05:30 here — and comparing that against a naive
// column silently shifts the window by five and a half hours. The first version of this
// script reported 92 customers against the app's 95 and the app was right both times.
//
// So the hand calculation passes ISO strings with the zone cut off, which is what Prisma
// sends. Any future tool reaching for raw SQL over a date range has the same problem.
import pg from 'pg';
import { consultations, funnel } from '../lib/metrics.ts';
import { rangeFor } from '../lib/range.ts';
import { costPer } from '../lib/calc.ts';

const days = Number(process.argv[2] ?? 30);
const { current } = rangeFor(days);

/** UTC, with the zone dropped — the shape a naive timestamp column compares correctly. */
const naive = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const from = naive(current.from);
const to = naive(current.to);

const [app, held] = await Promise.all([funnel(current), consultations(current)]);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const count = async (sql: string) => Number((await client.query(sql, [from, to])).rows[0].n);

const checks: [string, number, number][] = [
  [
    'Qualified lead',
    app.qualified,
    await count(`select count(*) n from lead where "createdAt" >= $1::timestamp and "createdAt" <= $2::timestamp and "qualifiedAt" is not null`),
  ],
  [
    'Semi-qualified lead',
    app.semiQualified,
    await count(`select count(*) n from lead where "createdAt" >= $1::timestamp and "createdAt" <= $2::timestamp and (status = 'semi_qualified' or "qualifiedAt" is not null)`),
  ],
  [
    'Consultation held (funnel)',
    app.opportunities,
    await count(`select count(*) n from opportunity where "createdAt" >= $1::timestamp and "createdAt" <= $2::timestamp`),
  ],
  // The same figure through the other call site. These were two hand-written copies of one
  // query until K2; this row is what would catch them drifting apart again.
  [
    'Consultation held (cost card)',
    held.total,
    await count(`select count(*) n from opportunity where "createdAt" >= $1::timestamp and "createdAt" <= $2::timestamp`),
  ],
  [
    'New customer',
    app.customers,
    await count(`select count(*) n from customer where "wonAt" >= $1::timestamp and "wonAt" <= $2::timestamp`),
  ],
];

console.log(`Definitions over the last ${days} days (${from} → ${to} UTC)\n`);
let failed = 0;
for (const [label, reported, byHand] of checks) {
  const ok = reported === byHand;
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  DIFF'} ${label.padEnd(30)} app=${reported}  by hand=${byHand}`);
}

// CPQL itself, which is the figure the manual names. Divided rather than counted, so it
// checks the arithmetic on top of the definition.
const spendRow = await client.query(
  `select coalesce(sum(s.amount), 0) total from marketing_spend s
     left join campaign c on c.id = s."campaignId"
    where s.date >= $1::timestamp and s.date <= $2::timestamp
      and coalesce(c.objective, '') not in ('recruitment', 'awareness')`,
  [from, to],
);
const byHandCpql = costPer(Number(spendRow.rows[0].total), held.total);
const reportedCpql = costPer(app.acquisitionSpend, app.opportunities);
console.log(
  `\n  CPQL: app=${reportedCpql?.toFixed(2) ?? '—'}  by hand=${byHandCpql?.toFixed(2) ?? '—'}` +
    `  (spend over ${held.total} consultations)`,
);
// Reported without a verdict where currencies are mixed: the app converts to the reporting
// currency and this sum does not, so the two agree only in a single-currency window.
console.log('  — compare the two only where the window is single-currency; this sum does not convert.');

await client.end();
if (failed > 0) {
  console.error(`\n${failed} definition(s) disagree with a hand calculation.`);
  process.exit(1);
}
console.log('\nEvery definition matches a hand calculation.');
