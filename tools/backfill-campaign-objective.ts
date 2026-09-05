// Classifies the campaigns that already exist, so G4's exclusion applies to history.
//
// The Meta sync writes `objective` from now on, but a sync only rewrites the campaigns it
// re-fetches, and a paused campaign from last November is not re-fetched. Left alone,
// every campaign already imported would keep a null objective — which `isAcquisition`
// counts as acquisition — so the hiring spend would stay in the denominator forever while
// the column sat there looking like it had fixed something.
//
// This reads the stored name only. It calls no API and invents nothing: the same
// `resolveObjective` the sync uses, given only the evidence the database already holds.
// A campaign the name does not settle is written as 'other', which counts as acquisition
// — the safe direction, because an unknown must overstate cost rather than understate it.
//
// Run:  node --experimental-strip-types --env-file-if-exists=.env.local tools/backfill-campaign-objective.ts
//       …the same with --apply to write.
//
// Safe to re-run: it is a pure function of the name and the stored platform objective, so
// a second run over unchanged rows writes the same values.

import pg from 'pg';
import { resolveObjective } from '../lib/campaign-objective.ts';

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query<{
  id: string;
  name: string;
  objective: string | null;
  platformObjective: string | null;
  spend: string;
}>(`SELECT c.id, c.name, c.objective, c."platformObjective",
           COALESCE(SUM(s.amount), 0)::text AS spend
      FROM campaign c
      LEFT JOIN marketing_spend s ON s."campaignId" = c.id
     GROUP BY c.id, c.name, c.objective, c."platformObjective"`);

console.log(`${rows.length} campaigns`);

const tally = new Map<string, { count: number; spend: number }>();
const changes: { id: string; name: string; from: string | null; to: string; spend: number }[] = [];

for (const row of rows) {
  const to = resolveObjective({ name: row.name, platformObjective: row.platformObjective });
  const spend = Number(row.spend);
  const acc = tally.get(to) ?? { count: 0, spend: 0 };
  tally.set(to, { count: acc.count + 1, spend: acc.spend + spend });
  if (row.objective !== to) changes.push({ id: row.id, name: row.name, from: row.objective, to, spend });
}

console.log('\nwhat the names say:');
for (const [k, v] of [...tally].sort((a, b) => b[1].spend - a[1].spend)) {
  console.log(`  ${String(v.count).padStart(4)}  ${k.padEnd(12)} ${v.spend.toFixed(2).padStart(14)}`);
}

// Named individually, because these are the rows that will move a number on a screen and
// somebody should be able to read the list before it does.
const excluded = changes.filter((c) => c.to !== 'acquisition' && c.to !== 'other');
console.log(`\n${excluded.length} campaigns leaving the acquisition denominator:`);
for (const c of excluded.sort((a, b) => b.spend - a.spend)) {
  console.log(`  ${c.spend.toFixed(2).padStart(12)}  ${c.to.padEnd(10)} ${c.name}`);
}

if (!apply) {
  console.log(`\nDry run. ${changes.length} rows would change. Re-run with --apply.`);
  await client.end();
  process.exit(0);
}

// One statement, one transaction. A half-applied classification would leave two campaigns
// in the same account on different sides of the exclusion, which is worse than neither.
await client.query('BEGIN');
try {
  for (const c of changes) {
    await client.query('UPDATE campaign SET objective = $1 WHERE id = $2', [c.to, c.id]);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

console.log(`\nWrote ${changes.length} rows.`);
await client.end();
