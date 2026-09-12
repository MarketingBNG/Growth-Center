/**
 * Reading untrusted vendor JSON into the shapes the rest of the app expects.
 *
 * Every provider adapter needs the same four coercions and, until now, each one declared
 * them again at the top of its own file — `num` five times and `str` six, byte-identical
 * in every copy, with a seventh `str` already exported from persist.ts that none of them
 * imported.
 *
 * Kept free of imports on purpose. persist.ts pulls in Prisma, so re-exporting its `str`
 * would have dragged a database client into nine provider modules and into the bare-Node
 * tests that exercise them. The dependency runs the other way instead: persist.ts takes
 * `str` from here.
 */

/** A number, or 0 when the vendor sent something that is not one. */
export const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A trimmed string, or null when it is absent or blank — never the empty string, which
 *  a natural key would happily store and then fail to match on the next sync. */
export const str = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

/**
 * Midnight UTC for the day a record belongs to.
 *
 * Stable across syncs, which is what keeps a metric point's unique key stable and makes a
 * re-sync an update rather than a new row. An unparseable date falls back to today's
 * midnight rather than epoch zero.
 */
export function startOfDay(value: unknown): Date {
  const raw = value == null ? '' : String(value);
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date(new Date().setUTCHours(0, 0, 0, 0));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * A whole number no smaller than `min`, for the counters and page numbers a paging cursor
 * carries back from wherever it was stored.
 *
 * `min` because the two kinds differ: an index or a seen-count starts at 0, a vendor's
 * page number at 1, and defaulting a page to 0 would ask Zoho for a page that does not
 * exist. A cursor is round-tripped through the database between runs, so this is the
 * point where anything malformed has to become a sane starting position rather than a
 * NaN that silently pages forever.
 */
export function intAtLeast(value: unknown, min = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : min;
}
