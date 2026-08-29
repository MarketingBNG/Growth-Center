// Re-runs channel attribution over leads that never landed on one.
//
// `channelSlugFor` learned several sources it used to miss — "Trademark_Meta", expos and
// summits, Smartlead, the firm's own site, a third spelling of LinkedIn. The leads already
// imported under those keep channelId null, because a sync only rewrites the records it
// re-fetches, and re-importing 27,000 leads to fix 1,100 of them is the wrong trade.
//
// So this reads each unattributed lead's stored sourceDetail, runs it through the current
// mapping, and writes the channel where the mapping now finds one. It invents nothing: a
// lead whose source still maps nowhere is left alone.
//
// Run:  node --experimental-strip-types tools/backfill-lead-channels.ts          (dry run)
//       node --experimental-strip-types tools/backfill-lead-channels.ts --apply  (writes)
//
// Safe to re-run, and safe to run again after the mapping learns more sources.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { channelSlugFor } from '../lib/integrations/crm-mapping.ts';
import type { SourceType } from '../lib/enums.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const channels = await client.query<{ id: string; slug: string }>('select id, slug from channel');
const idBySlug = new Map(channels.rows.map((c) => [c.slug, c.id]));

const leads = await client.query<{ id: string; sourceDetail: string | null; sourceType: string }>(
  'select id, "sourceDetail", "sourceType"::text from lead where "channelId" is null',
);

// Grouped by target channel: one UPDATE per channel beats one per lead, and the summary
// is the thing worth reading anyway.
const byChannel = new Map<string, string[]>();
const stillUnmapped = new Map<string, number>();

for (const lead of leads.rows) {
  const slug = channelSlugFor(lead.sourceType as SourceType, lead.sourceDetail);
  const channelId = slug ? idBySlug.get(slug) : undefined;
  if (!channelId) {
    const key = lead.sourceDetail ?? '(no source)';
    stillUnmapped.set(key, (stillUnmapped.get(key) ?? 0) + 1);
    continue;
  }
  const ids = byChannel.get(channelId) ?? [];
  ids.push(lead.id);
  byChannel.set(channelId, ids);
}

const slugById = new Map(channels.rows.map((c) => [c.id, c.slug]));
console.log(`${leads.rowCount} leads have no channel.\n`);
console.log('would map:');
for (const [channelId, ids] of byChannel) {
  console.log(`  ${String(ids.length).padStart(5)}  ${slugById.get(channelId)}`);
}
console.log('\nstill unmapped:');
for (const [detail, n] of [...stillUnmapped].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${detail}`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

await client.query('BEGIN');
try {
  let written = 0;
  for (const [channelId, ids] of byChannel) {
    const r = await client.query('update lead set "channelId" = $1 where id = any($2::text[])', [
      channelId,
      ids,
    ]);
    written += r.rowCount ?? 0;
  }
  await client.query('COMMIT');
  console.log(`\nAttributed ${written} leads.`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

await client.end();
