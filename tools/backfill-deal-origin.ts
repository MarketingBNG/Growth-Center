// Reads new-versus-repeat and one-off-versus-retainer out of every deal name.
//
// The sync fills these three columns from now on, but a sync only rewrites the records it
// re-fetches, and Zoho's watermark means it re-fetches almost nothing. So the 8,072 deals
// already imported would keep a null dealOrigin until each one happened to be edited in
// the CRM — which for a deal closed last year is never.
//
// This parses the stored name instead. It reads nothing from Zoho and invents nothing: a
// name that does not carry the convention is written as 'unknown', which is deliberately
// not 'new'.
//
// Run:  node --experimental-strip-types tools/backfill-deal-origin.ts          (dry run)
//       node --experimental-strip-types tools/backfill-deal-origin.ts --apply  (writes)
//
// Safe to re-run: it is a pure function of the name, so a second run over unchanged names
// writes the same values.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { parseDealName } from '../lib/deal-name.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query<{
  id: string;
  name: string;
  dealOrigin: string | null;
  engagementType: string | null;
  accountSequenceNo: number | null;
}>('SELECT id, name, "dealOrigin", "engagementType", "accountSequenceNo" FROM opportunity');

console.log(`${rows.length} deals`);

type Change = { id: string; origin: string; engagement: string | null; seq: number | null };
const changes: Change[] = [];
const tally = new Map<string, number>();
const engagementTally = new Map<string, number>();

for (const row of rows) {
  const parsed = parseDealName(row.name);
  tally.set(parsed.origin, (tally.get(parsed.origin) ?? 0) + 1);
  const engagementKey = parsed.engagementType ?? 'none';
  engagementTally.set(engagementKey, (engagementTally.get(engagementKey) ?? 0) + 1);

  const differs =
    row.dealOrigin !== parsed.origin ||
    row.engagementType !== parsed.engagementType ||
    row.accountSequenceNo !== parsed.sequenceNo;

  if (differs) {
    changes.push({
      id: row.id,
      origin: parsed.origin,
      engagement: parsed.engagementType,
      seq: parsed.sequenceNo,
    });
  }
}

console.log('\nwhat the names say:');
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log('engagement:');
for (const [k, v] of [...engagementTally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log(`\n${changes.length} rows differ from what is stored.`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

// One statement per batch rather than per row: 8,000 round trips against Neon is minutes,
// and this is a single derivable value per record with no ordering between them.
const BATCH = 500;
let written = 0;
try {
  await client.query('BEGIN');
  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    const values = batch
      .map((_, n) => `($${n * 4 + 1}, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4}::int)`)
      .join(', ');
    const params = batch.flatMap((c) => [c.id, c.origin, c.engagement, c.seq]);
    await client.query(
      `UPDATE opportunity AS o
         SET "dealOrigin" = v.origin,
             "engagementType" = v.engagement,
             "accountSequenceNo" = v.seq
         FROM (VALUES ${values}) AS v(id, origin, engagement, seq)
        WHERE o.id = v.id`,
      params,
    );
    written += batch.length;
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

console.log(`\nWrote ${written} rows.`);
await client.end();
