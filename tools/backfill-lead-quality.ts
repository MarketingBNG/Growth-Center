// Fills score, segment, lost reason and attribution confidence on the leads that already
// exist. §7.3, §7.4, §7.6 and G1.2.
//
// The sync writes all four from now on, but Zoho's watermark means a nightly sync
// re-fetches almost nothing — a lead created last November is never touched again. Left
// alone, `score` would stay 0 on 27,575 rows while looking like it had been fixed, which
// is the state the column was already in.
//
// Reads nothing from Zoho. Every value is a pure function of fields already stored:
// the source string and enum, the email domain, the phone, the message the person typed
// into the lead form, and the CRM's own status word.
//
// Run:  node --experimental-strip-types --env-file-if-exists=.env.local tools/backfill-lead-quality.ts
//       …the same with --apply to write.
//
// Safe to re-run: pure functions of unchanged fields write unchanged values.

import pg from 'pg';
import { resolveAttribution } from '../lib/attribution-confidence.ts';
import { lostReasonOf } from '../lib/lead-lost-reason.ts';
import { scoreLead, SCORE_VERSION } from '../lib/lead-score.ts';
import type { SourceType } from '../lib/generated/prisma/client.ts';

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

type Row = {
  id: string;
  status: string;
  sourceStatus: string | null;
  sourceType: string;
  sourceDetail: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  companyName: string | null;
  channelSlug: string | null;
  score: number;
  segment: string | null;
  lostReason: string | null;
  attributionConfidence: string | null;
};

const { rows } = await client.query<Row>(`
  SELECT l.id, l.status::text AS status, l."sourceStatus", l."sourceType"::text AS "sourceType",
         l."sourceDetail", l.email, l.phone, l.message, l."companyName",
         c.slug AS "channelSlug",
         l.score, l.segment, l."lostReason", l."attributionConfidence"
    FROM lead l
    LEFT JOIN channel c ON c.id = l."channelId"`);

console.log(`${rows.length} leads`);

type Wanted = {
  score: number;
  segment: string | null;
  lostReason: string | null;
  confidence: string;
};

const wanted = new Map<string, Wanted>();
const segments = new Map<string, number>();
const reasons = new Map<string, number>();
const confidences = new Map<string, number>();
const bands = new Map<string, number>();
let scoreSum = 0;

const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const row of rows) {
  const scored = scoreLead({
    channelSlug: row.channelSlug,
    email: row.email,
    phone: row.phone,
    message: row.message,
    sourceDetail: row.sourceDetail,
    companyName: row.companyName,
  });

  // The confidence is resolved from the same inputs channelSlugFor used, not read back
  // off the stored channel — a stored channelId says which channel was chosen and not how
  // well it was known, which is exactly the distinction G1.2 asks for.
  const { confidence } = resolveAttribution(row.sourceType as SourceType, row.sourceDetail);
  const lostReason = lostReasonOf({
    status: row.status,
    sourceStatus: row.sourceStatus,
    message: row.message,
  });

  wanted.set(row.id, { score: scored.total, segment: scored.segment, lostReason, confidence });

  count(segments, scored.segment ?? 'unsegmented');
  count(reasons, lostReason ?? 'not lost');
  count(confidences, confidence);
  count(bands, scored.total >= 60 ? 'hot' : scored.total >= 35 ? 'warm' : 'cold');
  scoreSum += scored.total;
}

const show = (title: string, m: Map<string, number>) => {
  console.log(`\n${title}:`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
};

show('segment', segments);
show('lost reason', reasons);
show('attribution confidence', confidences);
show('score band', bands);
console.log(`\nmean score ${(scoreSum / Math.max(1, rows.length)).toFixed(1)}`);

const changed = rows.filter((r) => {
  const w = wanted.get(r.id);
  return (
    w !== undefined &&
    (w.score !== r.score ||
      w.segment !== r.segment ||
      w.lostReason !== r.lostReason ||
      w.confidence !== r.attributionConfidence)
  );
});

if (!apply) {
  console.log(`\nDry run. ${changed.length} rows would change. Re-run with --apply.`);
  await client.end();
  process.exit(0);
}

// Batched, because 27,575 individual UPDATEs over a pooled connection to Neon is minutes
// of round trips. One transaction: a half-scored lead base would put two leads on
// different formulas, and the comparison between them is the thing the score is for.
const CHUNK = 500;
await client.query('BEGIN');
try {
  for (let i = 0; i < changed.length; i += CHUNK) {
    const slice = changed.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = slice.map((r, n) => {
      const w = wanted.get(r.id)!;
      values.push(r.id, w.score, SCORE_VERSION, w.segment, w.lostReason, w.confidence);
      return `($${n * 6 + 1}, $${n * 6 + 2}::int, $${n * 6 + 3}::int, $${n * 6 + 4}, $${n * 6 + 5}, $${n * 6 + 6})`;
    });

    await client.query(
      `UPDATE lead AS l
          SET score = v.score,
              "scoreVersion" = v.version,
              segment = v.segment,
              "lostReason" = v.reason,
              "attributionConfidence" = v.confidence
         FROM (VALUES ${tuples.join(', ')}) AS v(id, score, version, segment, reason, confidence)
        WHERE l.id = v.id`,
      values,
    );
    process.stdout.write(`\r  ${Math.min(i + CHUNK, changed.length)}/${changed.length}`);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

console.log(`\nWrote ${changed.length} rows.`);
await client.end();
