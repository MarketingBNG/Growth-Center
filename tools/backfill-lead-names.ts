// Removes the "[MERGED]" tag Zoho left in the names of already-imported leads.
//
// Zoho prefixes the surviving record's name with "[MERGED]" when it combines two
// duplicates. The tag lives inside the name field, so the import copied it verbatim and
// people were called "[MERGED] Arif Ibrahim" on screen and in search.
//
// `cleanImportedName` now strips it during the import, so nothing new arrives tagged.
// But a sync only rewrites the records it re-fetches, and these leads are older than the
// sync window — same reason tools/backfill-lead-channels.ts exists. This fixes the rows
// already stored.
//
// Uses the very same function the importer uses, so the two cannot drift: only the exact
// "[MERGED]" prefix goes. Square brackets are part of real names in this data
// ("Paramasivam [He/Him/His] PhD", "[AK] Anand") and are left untouched.
//
// Run:  node --experimental-strip-types tools/backfill-lead-names.ts          (dry run)
//       node --experimental-strip-types tools/backfill-lead-names.ts --apply  (writes)
//
// Safe to re-run: a lead fixed once no longer matches.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { cleanImportedName } from '../lib/integrations/crm-mapping.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

type Row = { id: string; firstName: string; lastName: string | null };

// Both name columns, and contacts as well as leads: Zoho can merge either, and the tag
// would read the same way on a contact.
async function fix(table: 'lead' | 'contact') {
  const { rows } = await client.query<Row>(
    `select id, "firstName", "lastName" from ${table}
      where "firstName" ilike '%[merged]%' or "lastName" ilike '%[merged]%'`,
  );

  const updates: { id: string; firstName: string; lastName: string | null; was: string }[] = [];

  for (const row of rows) {
    const first = cleanImportedName(row.firstName);
    const last = cleanImportedName(row.lastName);
    // The tag was the whole of the name — nothing to fall back to at this layer, so it
    // is reported and left rather than blanked.
    if (!first && !last) {
      console.log(`  ! ${table} ${row.id}: name is only the tag, left alone`);
      continue;
    }
    const was = [row.firstName, row.lastName].filter(Boolean).join(' ');
    // A lone surviving name belongs in firstName, the same shape splitName produces.
    updates.push(
      first
        ? { id: row.id, firstName: first, lastName: last, was }
        : { id: row.id, firstName: last!, lastName: null, was },
    );
  }

  console.log(`\n${table}: ${rows.length} tagged, ${updates.length} to rewrite`);
  for (const u of updates) {
    console.log(`  "${u.was}" -> "${[u.firstName, u.lastName].filter(Boolean).join(' ')}"`);
  }

  if (!apply || !updates.length) return updates.length;

  const result = await client.query(
    `update ${table} set "firstName" = v.first, "lastName" = nullif(v.last, '')
       from (select unnest($1::text[]) as id, unnest($2::text[]) as first, unnest($3::text[]) as last) v
      where ${table}.id = v.id`,
    [updates.map((u) => u.id), updates.map((u) => u.firstName), updates.map((u) => u.lastName ?? '')],
  );
  console.log(`  wrote ${result.rowCount}`);
  return updates.length;
}

const total = (await fix('lead')) + (await fix('contact'));

console.log(apply ? `\nDone. ${total} names rewritten.` : '\nDry run. Re-run with --apply to write.');

await client.end();
