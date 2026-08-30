// Pulls a provider's history in, rather than the last 30 days of it.
//
// `sync()` defaults to a 30-day window and the cron calls it with that default, so the
// sessions series only ever reached back 30 days from whenever it last ran — 34 days of
// history for a property connected on 28 July 2026. Every other series on the dashboard
// goes back years, and a funnel that puts 6,456 visitors above 16,213 leads is not
// reporting a leak, it is reporting the date the integration was switched on. CAC and
// ROAS divide across the same gap.
//
// GA4 is not missing that history — nobody asked for it. Aggregated date-by-date reports
// are not subject to the property's user-data retention setting, so a standard property
// will serve well past a year. This asks for all of it.
//
// Meta Ads has the same gap for the same reason, and it is the one that matters for
// money: CAC is spend over customers and ROAS is revenue over spend, so a month of spend
// against a year of either is wrong by the ratio of the two spans.
//
// The write is `ON CONFLICT DO UPDATE` on (source, entityType, entityId, metricKey,
// date), so overlapping days are rewritten with the same values and the tool is safe to
// re-run. Campaign rows match on (source, externalId) and update in place rather than
// duplicating, so a re-run does not fork the campaign list either.
//
// Run:  node --experimental-strip-types --env-file=.env.local tools/backfill-history.ts google_analytics
//       node --experimental-strip-types --env-file=.env.local tools/backfill-history.ts meta_ads 400
//
// This is a one-off per provider. The cron's rolling 30-day window is right for keeping
// current; it is only the history behind it that was never fetched.

import { sync } from '../lib/integrations/service.ts';
import { db } from '../lib/prisma.ts';

const DEFAULT_DAYS = 400;
const provider = process.argv[2];
const days = Number(process.argv[3]) || DEFAULT_DAYS;

if (!provider) {
  console.error('Usage: backfill-history.ts <provider> [days]   e.g. google_analytics, meta_ads');
  process.exit(1);
}

// The series each provider feeds, so the before/after reports what actually moved.
const SERIES: Record<string, string> = {
  google_analytics: 'sessions',
  meta_ads: 'spend',
};
const metricKey = SERIES[provider] ?? 'sessions';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Pass --env-file=.env.local.');
  process.exit(1);
}

const span = async () => {
  const [row] = await db().$queryRawUnsafe<{ mn: string | null; mx: string | null; n: number }[]>(
    `SELECT MIN(date)::text mn, MAX(date)::text mx, COUNT(*)::int n
       FROM metric_snapshot WHERE "metricKey" = $1 AND source <> 'demo'`,
    metricKey,
  );
  return row;
};

const before = await span();
console.log(`before: ${before.n} ${metricKey} rows, ${before.mn ?? '—'} → ${before.mx ?? '—'}`);
console.log(`asking ${provider} for ${days} days…`);

const result = await sync(provider, days);
console.log(`sync: ${result.detail ?? `${result.rows} rows`}`);

const after = await span();
console.log(`after:  ${after.n} ${metricKey} rows, ${after.mn ?? '—'} → ${after.mx ?? '—'}`);
console.log(`gained ${after.n - before.n} rows`);

process.exit(0);
