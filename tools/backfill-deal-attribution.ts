// G1.2 on the deal side.
//
// A deal in this CRM carries its own `Lead_Source`, so most of the time its confidence is
// read from that exactly as a lead's is. The interesting case is the deal that carries
// none but was converted from a lead that did: its channel is real evidence, one step
// removed, and calling that as certain as the lead's own statement is what made revenue
// attribution look firmer than it is.
//
// Run:  node --experimental-strip-types --env-file-if-exists=.env.local tools/backfill-deal-attribution.ts
//       …the same with --apply to write.

import pg from 'pg';
import { inheritedConfidence, resolveAttribution, type AttributionConfidence } from '../lib/attribution-confidence.ts';
import { leadSourceType } from '../lib/integrations/crm-mapping.ts';

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query<{
  id: string;
  sourceDetail: string | null;
  attributionConfidence: string | null;
  channelId: string | null;
  leadConfidence: string | null;
  leadChannelId: string | null;
}>(`
  SELECT o.id, o."sourceDetail", o."attributionConfidence", o."channelId",
         l."attributionConfidence" AS "leadConfidence", l."channelId" AS "leadChannelId"
    FROM opportunity o
    LEFT JOIN lead l ON l.id = o."leadId"`);

console.log(`${rows.length} deals`);

const tally = new Map<string, number>();
const changes: { id: string; to: AttributionConfidence }[] = [];

for (const row of rows) {
  // The deal's own statement first. Only when it has none does the lead's carry, and
  // then one step weaker.
  const own = resolveAttribution(leadSourceType(row.sourceDetail), row.sourceDetail).confidence;
  const to =
    own !== 'none'
      ? own
      : row.leadChannelId
        ? inheritedConfidence(row.leadConfidence as AttributionConfidence | null)
        : 'none';

  tally.set(to, (tally.get(to) ?? 0) + 1);
  if (row.attributionConfidence !== to) changes.push({ id: row.id, to });
}

console.log('\nattribution confidence:');
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}  (${((v / rows.length) * 100).toFixed(1)}%)`);
}

if (!apply) {
  console.log(`\nDry run. ${changes.length} rows would change. Re-run with --apply.`);
  await client.end();
  process.exit(0);
}

const CHUNK = 500;
await client.query('BEGIN');
try {
  for (let i = 0; i < changes.length; i += CHUNK) {
    const slice = changes.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = slice.map((c, n) => {
      values.push(c.id, c.to);
      return `($${n * 2 + 1}, $${n * 2 + 2})`;
    });
    await client.query(
      `UPDATE opportunity AS o SET "attributionConfidence" = v.confidence
         FROM (VALUES ${tuples.join(', ')}) AS v(id, confidence) WHERE o.id = v.id`,
      values,
    );
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

console.log(`\nWrote ${changes.length} rows.`);
await client.end();
