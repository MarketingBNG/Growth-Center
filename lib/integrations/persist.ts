import { db } from '../prisma.ts';
import type { MetricPoint } from './types.ts';

// The generic persistence plumbing every writer in lib/integrations/writers/ shares:
// the chunked raw-SQL upsert, the metric_snapshot writer it grew out of, and the small
// defensive readers every materialiser uses on a point's payload. Split out of
// lib/integrations/service.ts alongside the writers themselves.

/** Writes a provider's points into MetricSnapshot. Upserts on the natural key so a
 *  re-sync of the same day corrects the value instead of duplicating it.
 *
 *  Written as a multi-row INSERT ... ON CONFLICT rather than a loop of Prisma upserts.
 *  The loop was one network round trip per row: a month of Meta campaign data is around
 *  700 rows, which took over a hundred seconds against Neon and blew the serverless
 *  function limit long before it finished. One statement per chunk instead. */
export const WRITE_CHUNK = 500;

/** Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row twice within
 *  one statement ("cannot affect row a second time"), so a batch carrying two points with
 *  the same natural key aborts the whole chunk. Providers legitimately emit those: an
 *  account whose campaigns report the same metric on the same day, or a paged pull whose
 *  last page overlaps the next one's first. Collapse them here, last value winning, which
 *  is the same outcome the upsert would have produced row by row. */
function dedupePoints(points: MetricPoint[]): MetricPoint[] {
  const byKey = new Map<string, MetricPoint>();
  for (const p of points) {
    const day = p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date);
    byKey.set(JSON.stringify([p.entityType, p.entityId ?? '', p.metricKey, day]), p);
  }
  return [...byKey.values()];
}

export async function writePoints(source: string, rawPoints: MetricPoint[]): Promise<number> {
  // `record` points are not archived, because there is nothing in them to archive.
  //
  // A metric_snapshot row holds source, entityType, entityId, metricKey, date and value
  // — there is no payload column — so a `record` point stores only "this entity existed",
  // which the typed tables already say better: lead, contact, opportunity and prospect
  // each carry `source` and `externalId`. Nothing reads them back either; the
  // materialisers below filter the same in-memory `points` array this function receives,
  // never the database.
  //
  // They were 258,802 of the table's 277,886 rows and about 35 MB of a 118 MB table —
  // 93% of it — growing with every record the CRM holds rather than with time, which is
  // why a retention window would have freed almost nothing. The 19,084 genuine
  // time-series rows are what the charts read, and they are all kept.
  const points = dedupePoints(rawPoints).filter((p) => p.metricKey !== 'record');
  if (!points.length) return 0;

  let written = 0;

  for (let i = 0; i < points.length; i += WRITE_CHUNK) {
    const chunk = points.slice(i, i + WRITE_CHUNK);

    // @default(cuid()) is applied by Prisma, not by Postgres, so a raw insert has to
    // supply the id itself. gen_random_uuid() is built in from PG13 — a uuid rather than
    // a cuid, which only these provider-written rows will carry.
    const values = chunk.map((p) => [
      source,
      p.entityType,
      p.entityId ?? '',
      p.metricKey,
      p.date,
      p.value,
    ]);

    const placeholders = values
      .map(
        (_, r) =>
          `(gen_random_uuid()::text, $${r * 6 + 1}, $${r * 6 + 2}, $${r * 6 + 3}, $${r * 6 + 4}, $${r * 6 + 5}::date, $${r * 6 + 6}::numeric)`,
      )
      .join(', ');

    written += await db().$executeRawUnsafe(
      `INSERT INTO metric_snapshot (id, source, "entityType", "entityId", "metricKey", date, value)
       VALUES ${placeholders}
       ON CONFLICT (source, "entityType", "entityId", "metricKey", date)
       DO UPDATE SET value = EXCLUDED.value`,
      ...values.flat(),
    );
  }

  return written;
}

/**
 * One chunked `INSERT … ON CONFLICT DO UPDATE`, returning the id of every row it touched.
 *
 * The CRM import writes tens of thousands of records — this org has 26,000 leads alone —
 * and a per-record Prisma upsert is one network round trip each. At that size the sync
 * cannot finish inside the cron's 300s budget, so the rows go out in batches the way
 * writePoints and writeCampaignSpend already do.
 *
 * `casts` carries the Postgres type for any column a text placeholder cannot satisfy on
 * its own — the enum columns and the numerics.
 */
export async function bulkUpsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
  casts: Record<string, string> = {},
  /** False for the few tables Prisma gave no updatedAt column — sequence_step. */
  stamped = true,
): Promise<{ id: string; externalId: string | null }[]> {
  if (!rows.length) return [];

  // Same rule that forced dedupePoints: one statement may not update a row twice, so two
  // rows sharing the conflict key abort the chunk. The key columns are named in
  // `conflict`, so they can be read off it rather than passed again.
  const keyColumns = conflict.split(',').map((c) => c.trim().replace(/"/g, ''));
  const keyIndexes = keyColumns.map((c) => columns.indexOf(c)).filter((i) => i >= 0);
  if (keyIndexes.length === keyColumns.length) {
    const byKey = new Map<string, unknown[]>();
    for (const r of rows) byKey.set(JSON.stringify(keyIndexes.map((i) => r[i])), r);
    rows = [...byKey.values()];
  }

  const cols = stamped ? [...columns, 'updatedAt'] : [...columns];
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const assignments = cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  // Only tables that carry provenance can return it; sequence_step is keyed on its
  // parent and position instead.
  const returning = columns.includes('externalId') ? 'id, "externalId"' : 'id, NULL AS "externalId"';
  const touched: { id: string; externalId: string | null }[] = [];

  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const values = stamped ? chunk.map((r) => [...r, new Date()]) : chunk.map((r) => [...r]);
    const width = cols.length;

    const placeholders = values
      .map((_, r) => {
        const cells = cols.map((c, k) => {
          const n = r * width + k + 1;
          return casts[c] ? `$${n}::${casts[c]}` : `$${n}`;
        });
        return `(gen_random_uuid()::text, ${cells.join(', ')})`;
      })
      .join(', ');

    const returned = await db().$queryRawUnsafe<{ id: string; externalId: string | null }[]>(
      `INSERT INTO "${table}" (id, ${quoted})
       VALUES ${placeholders}
       ON CONFLICT (${conflict}) DO UPDATE SET ${assignments}
       RETURNING ${returning}`,
      ...values.flat(),
    );
    touched.push(...returned);
  }

  return touched;
}

/** A point's provider payload, and a trimmed string from it — every materialiser reads
 *  entityMeta the same defensive way, so they read it through these. */
export const meta = (p: MetricPoint) => (p.entityMeta ?? {}) as Record<string, unknown>;
export const str = (v: unknown): string | null => {
  const t = v == null ? '' : String(v).trim();
  return t === '' ? null : t;
};

/**
 * An imported address, lower-cased.
 *
 * The CRM stores whatever was typed — 1,411 leads here begin with a capital — and the
 * duplicate check matches on exact equality against an index, so a returning enquirer
 * whose stored address reads `Sam@gmail.com` was never matched to `sam@gmail.com` and
 * arrived as a second lead.
 *
 * Case only. `normalizeEmail` also strips gmail dots and +tags, which is right for
 * comparison and wrong for storage: the address on the record has to stay the one you
 * could actually write to.
 */
export const importedEmail = (value: unknown): string | null => {
  const email = str(value);
  return email ? email.toLowerCase() : null;
};

/**
 * When the CRM says the record was created, for the row's own createdAt.
 *
 * Left to default(now()) every imported record is stamped with the moment of the import
 * instead — 26,043 of 26,138 leads landed on one day, so every trend chart showed a
 * single spike on import day and every period-over-period delta compared a full CRM
 * against nothing. The provider already dates each point from the CRM's Created_Time;
 * this is only carrying it through to the table the pages read.
 */
export const createdAtOf = (p: MetricPoint): Date => {
  // The provider's own timestamp when it sent one. A point's `date` is a day — metric
  // rows are keyed on it — so using it here put every record on exactly midnight, losing
  // the order of arrivals within a day and any measure that subtracts from them.
  const exact = str(meta(p).createdAt);
  if (exact) {
    const d = new Date(exact);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return p.date;
};
