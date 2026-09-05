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

/**
 * A phone number reduced to the digits that identify it, or null if there are too few.
 *
 * Numbers arrive from this CRM as somebody typed them — "98101 89048",
 * "+91 9008858515", "9810189048" — so the same person's number is three different
 * strings. Duplicate matching needs one.
 *
 * The last ten digits, not all of them. This organisation's numbers are overwhelmingly
 * Indian and a leading +91 is written on some records and omitted on others, so comparing
 * the full string would treat "+919810189048" and "9810189048" as different people. Ten
 * digits is India's subscriber-number length and enough of a US number to identify it
 * given the area code.
 *
 * Under ten digits returns null rather than matching on what is there: a five-digit
 * extension is not an identity, and grouping on one would propose merging everybody who
 * happened to share it.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
