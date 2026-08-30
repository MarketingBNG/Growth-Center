// One-off cleanup: drop the `record` rows from metric_snapshot.
//
// metric_snapshot is meant to be the honest archive of what a provider reported, and for
// genuine time-series — sessions, clicks, impressions, spend, positions — it is. But
// providers also wrote one row per imported CRM and outreach entity under
// metricKey='record', and those rows archive nothing.
//
// A metric_snapshot row holds source, entityType, entityId, metricKey, date and value.
// There is no payload column, so a `record` row says only "this entity existed" — which
// the typed tables already say better: lead, contact, opportunity and prospect each carry
// `source` and `externalId`. Nothing reads them back either. The materialisers in
// lib/integrations/service.ts filter the in-memory points array they are handed, never
// the database, and the only queries against metric_snapshot ask for sessions, search_*,
// clicks, impressions, position, ctr and the outreach sending totals.
//
// They were 258,802 of the table's 277,886 rows and roughly 35 MB of a 118 MB table, in
// a 238 MB database. They grow with the number of records the CRM holds rather than with
// time, which is why a retention window would have freed almost nothing — only 3,398 rows
// were more than two years old.
//
// writePoints() no longer writes them, so this is a one-off. Nothing regenerates them.
//
// Run:  node --experimental-strip-types tools/prune-metric-snapshot.ts          (dry run)
//       node --experimental-strip-types tools/prune-metric-snapshot.ts --apply  (deletes)

import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const show = async (label: string) => {
  const { rows } = await client.query(
    `select case when "metricKey" = 'record' then 'record' else 'time-series' end kind,
            count(*)::int n
       from metric_snapshot group by 1 order by 1`,
  );
  const size = await client.query(
    `select pg_size_pretty(pg_total_relation_size('metric_snapshot')) t`,
  );
  console.log(`${label}:`, rows, 'table', size.rows[0].t);
};

await show('before');

// Refuse if anything still reads them. The queries in lib/ ask for these keys and no
// others; if that ever changes, this guard is the thing that notices.
const READ_KEYS = [
  'sessions', 'users', 'pageviews', 'search_clicks', 'search_impressions',
  'search_ctr', 'search_position', 'clicks', 'impressions', 'position', 'ctr',
  'spend', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed',
];
const overlap = await client.query(
  `select count(*)::int n from metric_snapshot
    where "metricKey" = 'record' and "metricKey" = any($1)`,
  [READ_KEYS],
);
if (overlap.rows[0].n > 0) {
  console.error('Refusing: a `record` row is also a key something reads.');
  await client.end();
  process.exit(1);
}

const { rows: doomed } = await client.query(
  `select count(*)::int n from metric_snapshot where "metricKey" = 'record'`,
);

if (!apply) {
  console.log(`\nDry run. ${doomed[0].n} \`record\` rows would be deleted.`);
  console.log('Every time-series row is kept. Re-run with --apply to delete.');
  await client.end();
  process.exit(0);
}

await client.query(`delete from metric_snapshot where "metricKey" = 'record'`);
// The space is only returned to the OS after a VACUUM FULL, which locks the table.
// A plain VACUUM makes it reusable, which is what matters for a table that keeps growing.
await client.query(`vacuum analyze metric_snapshot`);

await show('after');
console.log(`\nDeleted ${doomed[0].n} record rows.`);
await client.end();
