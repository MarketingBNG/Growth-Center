import { z } from 'zod';

/**
 * The id of a record in this database, whichever way it was created.
 *
 * Prisma stamps `@default(cuid())` on rows this app writes, but the integration sync
 * inserts through raw SQL and lets Postgres supply `gen_random_uuid()::text`. Both are
 * legitimate ids of the same table, and every validator here demanded a cuid — so a note
 * or a task aimed at any of the 2,953 synced companies or 5,101 synced contacts was
 * rejected as "Invalid input" before it reached the database. The Notes box on those
 * records could not save at all.
 *
 * Deliberately a shape check rather than a format one: the id is looked up, and an id
 * that matches nothing simply finds nothing. What this has to stop is a value long or
 * strange enough to be worth passing to a query at all.
 */
export const recordId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Not a record id');
