// Re-runs channel attribution over every lead and deal, not just the unattributed ones.
//
// `tools/backfill-lead-channels.ts` only touches rows whose channelId is null, which was
// right while the mapping was only ever *learning* sources. Splitting Canada, Landing
// Page and Incorp out of the channels that used to swallow them is the other kind of
// change: those leads already have a channel, and it is now the wrong one. 365 sat inside
// Meta Ads and 3,468 inside Direct, so no amount of null-filling would move them.
//
// Creates any channel the mapping now names and the database does not have, then rewrites
// every row whose computed channel differs from its stored one. Deals as well as leads —
// Marketing resolves a customer's channel lead-first and deal-second, and leaving the
// deals behind would put a channel's customers and its money on different rows.
//
// Invents nothing: a row whose source maps nowhere keeps whatever it has.
//
// Run:  node --experimental-strip-types tools/remap-lead-channels.ts          (dry run)
//       node --experimental-strip-types tools/remap-lead-channels.ts --apply  (writes)
//
// Safe to re-run: a second run finds nothing to do.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { channelSlugFor, leadSourceType } from '../lib/integrations/crm-mapping.ts';
import type { SourceType } from '../lib/enums.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

/** Channels the mapping can now name. Kind matters: Marketing's ROAS and CAC are measured
 *  against the channels that carried spend, and `paid` is what puts Canada among them. */
const REQUIRED = [
  { slug: 'canada', name: 'Canada', kind: 'paid' },
  { slug: 'landing-page', name: 'Landing Page', kind: 'direct' },
  { slug: 'incorp', name: 'Incorp', kind: 'direct' },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const existing = await client.query<{ id: string; slug: string }>('select id, slug from channel');
const missing = REQUIRED.filter((c) => !existing.rows.some((r) => r.slug === c.slug));

console.log(
  missing.length
    ? `channels to create: ${missing.map((c) => c.slug).join(', ')}`
    : 'channels: all present',
);

if (missing.length && apply) {
  for (const c of missing) {
    await client.query(
      `insert into channel (id, slug, name, kind, "createdAt")
       values ($1, $2, $3, $4, now()) on conflict (slug) do nothing`,
      [`ch_${c.slug.replace(/-/g, '_')}`, c.slug, c.name, c.kind],
    );
  }
  console.log(`created ${missing.length} channels.`);
}

// Re-read so the new ids are in the map. On a dry run the missing ones simply are not
// there yet, and their rows are reported as "would need a channel that does not exist".
const channels = await client.query<{ id: string; slug: string }>('select id, slug from channel');
const idBySlug = new Map(channels.rows.map((c) => [c.slug, c.id]));
const slugById = new Map(channels.rows.map((c) => [c.id, c.slug]));

type Row = { id: string; sourceDetail: string | null; channelId: string | null };

/** Rows whose computed channel is not the one stored, grouped by target. */
async function plan(table: 'lead' | 'opportunity', sourceTypeOf: (r: Row) => SourceType) {
  const rows = await client.query<Row>(
    `select id, "sourceDetail", "channelId" from ${table}`,
  );

  const moves = new Map<string, string[]>();
  const unresolved = new Map<string, number>();

  for (const row of rows.rows) {
    const slug = channelSlugFor(sourceTypeOf(row), row.sourceDetail);
    if (!slug) continue; // maps nowhere — leave it exactly as it is
    const target = idBySlug.get(slug);
    if (!target) {
      unresolved.set(slug, (unresolved.get(slug) ?? 0) + 1);
      continue;
    }
    if (target === row.channelId) continue; // already right
    moves.set(target, [...(moves.get(target) ?? []), row.id]);
  }

  console.log(`\n${table}: ${rows.rowCount} rows`);
  const total = [...moves.values()].reduce((n, ids) => n + ids.length, 0);
  if (!total) console.log('  nothing to move');
  for (const [target, ids] of [...moves].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(ids.length).padStart(6)} -> ${slugById.get(target)}`);
  }
  for (const [slug, n] of unresolved) {
    console.log(`  ${String(n).padStart(6)} would need channel "${slug}", which does not exist yet`);
  }
  return moves;
}

// A deal stores the source string but no SourceType column, so its type is derived from
// the same string — exactly what the importer does when it writes one.
const leadMoves = await plan('lead', (r) => leadSourceType(r.sourceDetail));
const dealMoves = await plan('opportunity', (r) => leadSourceType(r.sourceDetail));

// Derived revenue carries its own channelId, copied at insert from the lead's channel and
// falling back to the deal's. Moving the leads leaves it pointing at the channel they came
// from, so "Revenue by channel" would report money under Direct that the same page counts
// as Landing Page leads.
//
// The next sync would repair this on its own — writeRevenue's ON CONFLICT recomputes the
// column — but "on the next sync" is not when someone opens the Marketing page.
//
// Only derived rows: manual revenue carries no opportunity and nobody's hand-entered
// channel is overwritten here.
const staleRevenue = `
  FROM opportunity o
  LEFT JOIN lead l ON l.id = o."leadId"
  WHERE r."opportunityId" = o.id
    AND r."channelId" IS DISTINCT FROM COALESCE(l."channelId", o."channelId")`;

const revenueCount = await client.query<{ n: string }>(
  `SELECT count(*) n FROM revenue_entry r WHERE r."opportunityId" IS NOT NULL
     AND EXISTS (SELECT 1 ${staleRevenue})`,
);
console.log(`\nrevenue_entry: ${revenueCount.rows[0].n} rows on a stale channel`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

// One transaction over both tables: a half-applied remap would leave Marketing's
// lead-first customer resolution reading a lead and a deal on different channels.
await client.query('BEGIN');
try {
  let written = 0;
  for (const [table, moves] of [
    ['lead', leadMoves],
    ['opportunity', dealMoves],
  ] as const) {
    for (const [channelId, ids] of moves) {
      const r = await client.query(
        `update ${table} set "channelId" = $1 where id = any($2::text[])`,
        [channelId, ids],
      );
      written += r.rowCount ?? 0;
    }
  }

  const rev = await client.query(
    `UPDATE revenue_entry r
        SET "channelId" = COALESCE(l."channelId", o."channelId")
       FROM opportunity o
       LEFT JOIN lead l ON l.id = o."leadId"
      WHERE r."opportunityId" = o.id
        AND r."channelId" IS DISTINCT FROM COALESCE(l."channelId", o."channelId")`,
  );

  await client.query('COMMIT');
  console.log(`\nMoved ${written} rows, and re-attributed ${rev.rowCount ?? 0} revenue entries.`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

await client.end();
