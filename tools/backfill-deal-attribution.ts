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

import { chunks, connect, placeholders, stopUnlessApplying, transact } from './script.ts';
import { inheritedConfidence, resolveAttribution, type AttributionConfidence } from '../lib/money/attribution-confidence.ts';
import { leadSourceType } from '../lib/integrations/crm-mapping.ts';

const client = await connect();

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

await stopUnlessApplying(
  client,
  `\nDry run. ${changes.length} rows would change. Re-run with --apply.`,
);

const CHUNK = 500;
await transact(client, async () => {
  for (const slice of chunks(changes, CHUNK)) {
    await client.query(
      `UPDATE opportunity AS o SET "attributionConfidence" = v.confidence
         FROM (VALUES ${placeholders(slice.length, [null, null])}) AS v(id, confidence) WHERE o.id = v.id`,
      slice.flatMap((c) => [c.id, c.to]),
    );
  }
});

console.log(`\nWrote ${changes.length} rows.`);
await client.end();
