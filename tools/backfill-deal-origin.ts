// Reads new-versus-repeat and one-off-versus-retainer out of every deal, in two passes.
//
// Pass 1 reads the deal name, which answers for 5,874 of 8,072. Pass 2 takes the deals
// the name left as 'unknown' and asks account history instead — did this account already
// have a deal? — which answers for most of the rest. Both passes write `originSource` so
// the two can be told apart afterwards; see lib/deal-origin.ts for why that matters and
// why the first day's import is deliberately left unclassified.
//
// The passes run in this order and not the other: a name is a statement by the person who
// opened the deal, and it always wins over an inference drawn from timestamps.
//
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
import type { DealOrigin } from '../lib/deal-name.ts';
import { deriveFromHistory } from '../lib/deal-origin.ts';
import type { OriginSource } from '../lib/deal-origin.ts';

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
  companyId: string | null;
  contactId: string | null;
  createdAt: Date;
  dealOrigin: string | null;
  originSource: string | null;
  engagementType: string | null;
  accountSequenceNo: number | null;
}>(`SELECT id, name, "companyId", "contactId", "createdAt",
           "dealOrigin", "originSource", "engagementType", "accountSequenceNo"
      FROM opportunity`);

console.log(`${rows.length} deals`);

type Wanted = {
  origin: DealOrigin;
  source: OriginSource | null;
  engagement: string | null;
  seq: number | null;
};

const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

// ── Pass 1: the deal name ─────────────────────────────────────────────────────────────

const wanted = new Map<string, Wanted>();
const tally = new Map<string, number>();
const engagementTally = new Map<string, number>();

for (const row of rows) {
  const parsed = parseDealName(row.name);
  count(tally, parsed.origin);
  count(engagementTally, parsed.engagementType ?? 'none');
  wanted.set(row.id, {
    origin: parsed.origin,
    source: parsed.origin === 'unknown' ? null : 'name',
    engagement: parsed.engagementType,
    seq: parsed.sequenceNo,
  });
}

console.log('\nwhat the names say:');
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log('engagement:');
for (const [k, v] of [...engagementTally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}

// ── Pass 2: account history, for what pass 1 left unknown ─────────────────────────────
//
// Previewed here with the same function the write below uses, so the dry run reports the
// verdicts that would actually land. Every deal is passed in, not just the unknowns: a
// deal the name already classified still occupies a position in its account's run, and
// dropping it would make the deal after it look like the first.

const verdicts = deriveFromHistory(
  rows.map((row) => ({
    id: row.id,
    accountKey: row.companyId ?? (row.contactId ? `c:${row.contactId}` : null),
    createdAt: row.createdAt,
    origin: wanted.get(row.id)!.origin,
  })),
);

const historyTally = new Map<string, number>();
for (const verdict of verdicts) {
  count(historyTally, verdict.origin);
  const current = wanted.get(verdict.id)!;
  wanted.set(verdict.id, { ...current, origin: verdict.origin, source: verdict.source });
}

const stillUnknown = [...wanted.values()].filter((w) => w.origin === 'unknown').length;
console.log('\nwhat account history adds:');
for (const [k, v] of [...historyTally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log(`  ${String(stillUnknown).padStart(5)}  left unknown (nothing to read, or the first import)`);

// ── What actually differs from the stored row ─────────────────────────────────────────

type Change = Wanted & { id: string };
const changes: Change[] = [];

for (const row of rows) {
  const w = wanted.get(row.id)!;
  const differs =
    row.dealOrigin !== w.origin ||
    row.originSource !== w.source ||
    row.engagementType !== w.engagement ||
    row.accountSequenceNo !== w.seq;
  if (differs) changes.push({ id: row.id, ...w });
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
      .map(
        (_, n) =>
          `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5}::int)`,
      )
      .join(', ');
    const params = batch.flatMap((c) => [c.id, c.origin, c.source, c.engagement, c.seq]);
    await client.query(
      `UPDATE opportunity AS o
         SET "dealOrigin" = v.origin,
             "originSource" = v.source,
             "engagementType" = v.engagement,
             "accountSequenceNo" = v.seq
         FROM (VALUES ${values}) AS v(id, origin, source, engagement, seq)
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
