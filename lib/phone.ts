import { db } from './prisma.ts';

/**
 * Ids whose phone number contains these digits, however the number is punctuated.
 *
 * Numbers arrive from the CRM exactly as somebody typed them - "98101 89048",
 * "+91 9008858515", "(917) 981-9599" - so a `contains` on the search box missed every
 * number a reader would type from memory. This strips the punctuation on both sides in
 * the database and matches on digits alone.
 *
 * The character class is spelled out rather than written as a backslash escape: that has
 * to survive both the JavaScript string and Postgres, and the one that reached the
 * database matched a literal D, stripping the letter and leaving the spaces in place.
 *
 * The table name is a literal from a union, never caller input; the digits are bound as a
 * parameter. Capped, because the id list goes back into a Prisma `in`.
 */
export async function phoneMatches(table: 'company' | 'contact' | 'lead', term: string): Promise<string[]> {
  const digits = term.replace(/[^0-9]/g, '');
  // Under four digits matches most of the book and is never what someone means by a
  // phone search.
  if (digits.length < 4) return [];

  const rows = await db().$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE $1 LIMIT 500`,
    `%${digits}%`,
  );
  return rows.map((r) => r.id);
}
