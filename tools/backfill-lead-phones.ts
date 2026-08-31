// Recovers the phone numbers stranded in the name field.
//
// When Zoho holds no first or last name for a lead — WhatsApp and social lead-ad
// enquiries, mostly — `splitName` falls back to the record's label, and for those
// records the label is the phone number. So the lead arrives called "+918591386884"
// with its `phone` column empty: the number is on screen but unsearchable as a phone
// and unusable for dialling.
//
// This copies the number out of the name and into `phone`, where it belongs. It does
// NOT touch the name: Zoho has no name for these people, so the number is still the
// only identity the row has, and blanking it would leave an anonymous row instead of
// an oddly-named one.
//
// Leaves alone any lead that already has a phone stored — a number a human entered
// beats one parsed out of a name field.
//
// Run:  node --experimental-strip-types tools/backfill-lead-phones.ts          (dry run)
//       node --experimental-strip-types tools/backfill-lead-phones.ts --apply  (writes)
//
// Safe to re-run: a lead fixed once no longer matches.

import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

/**
 * A name that is really a phone number: optional +, then digits and the punctuation
 * people put between them, and nothing else. Deliberately strict — a name is only
 * rewritten when it contains no letters at all, so "Ravi 9876543210" is left alone
 * rather than half-guessed at.
 */
const PHONE_NAME = /^\+?[0-9][0-9\s()+-]{6,}$/;

/** Digits, keeping a leading +. Nothing more clever: these come from one CRM and are
 *  already close to E.164, and inventing a country code would be inventing data. */
function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (plus ? '+' : '') + digits;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query<{ id: string; firstName: string }>(
  `select id, "firstName" from lead
   where "firstName" is not null and (phone is null or phone = '')`,
);

const updates: { id: string; phone: string }[] = [];
let skipped = 0;

for (const row of rows) {
  if (!PHONE_NAME.test(row.firstName)) continue;
  const phone = normalize(row.firstName);
  if (!phone) {
    skipped += 1;
    continue;
  }
  updates.push({ id: row.id, phone });
}

console.log(`${rows.length} leads have no phone stored.`);
console.log(`${updates.length} of them are named by a phone number.`);
if (skipped) console.log(`${skipped} looked like numbers but were not a usable length — left alone.`);

for (const u of updates.slice(0, 8)) console.log(`  ${u.phone}`);
if (updates.length > 8) console.log(`  … and ${updates.length - 8} more`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.');
} else if (updates.length) {
  // One statement, not one per lead: the ids and numbers go over as two arrays and
  // Postgres joins them.
  const result = await client.query(
    `update lead set phone = v.phone
       from (select unnest($1::text[]) as id, unnest($2::text[]) as phone) v
      where lead.id = v.id`,
    [updates.map((u) => u.id), updates.map((u) => u.phone)],
  );
  console.log(`\nWrote ${result.rowCount} phone numbers.`);
} else {
  console.log('\nNothing to write.');
}

await client.end();
