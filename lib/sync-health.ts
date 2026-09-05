import { db } from './prisma.ts';
import { getProvider } from './integrations/registry.ts';
import { thresholds } from './settings.ts';

// G5.1 and G5.2: how the integrations have actually been behaving, rather than how the
// last run went.
//
// Integration carries `lastSyncAt`, `lastSyncRows` and `lastError`, and each run
// overwrote the one before. A provider that had failed six nights running and then
// succeeded was, by the next morning, indistinguishable from one that had never failed.
// There was no way to see that a nightly sync had been importing four rows since April,
// and no way to tell a healthy integration from a lucky one.
//
// SyncRun records every attempt. This reads it.

/**
 * Three states, with two thresholds between them — G5.2 asks for exactly this and the
 * existing `sync_stale_or_failed` rule had only one.
 *
 * The distinction is worth the second threshold: amber is a night that went wrong, red is
 * a system that has stopped. One is worth a glance in the morning and the other is worth
 * interrupting somebody, and a single 24-hour line called both of them the same thing.
 */
export type Freshness = 'fresh' | 'stale' | 'broken';

export type ProviderHealth = {
  provider: string;
  name: string;
  freshness: Freshness;
  lastSuccessAt: Date | null;
  hoursSinceSuccess: number | null;
  lastError: string | null;
  /** How many of the recent runs failed, and out of how many. A ratio, not a streak:
   *  a provider that fails every other night is broken in a way a streak counter that
   *  keeps resetting will never show. */
  recentFailures: number;
  recentRuns: number;
  /** Median rows across the recent successful runs. A sync importing nothing every night
   *  is reported as succeeding, which is true and not the whole truth. */
  medianRows: number | null;
  /** True when the provider has never recorded a run — new table, no history yet. An
   *  absence of records is not a record of absence, and the panel says so rather than
   *  rendering an empty chart as a clean bill of health. */
  noHistory: boolean;
  /** Whether the provider runs on the shared nightly cron at all. PageSpeed has its own
   *  schedule and is not stale for having missed a run it was never in. */
  ownSchedule: boolean;
};

/** How many runs back "recently" reaches. A week of nightly runs, plus room for the
 *  manual Sync now presses that happen alongside them. */
const WINDOW = 20;

const hours = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One row per connected provider.
 *
 * Freshness is measured from the last *successful* run, not the last run. A provider that
 * has failed every night for a week has a recent `lastSyncAt` on some readings and is not
 * fresh by any of them — measuring from the attempt would have called the worst case
 * healthy.
 */
export async function syncHealth(now = new Date()): Promise<ProviderHealth[]> {
  const [integrations, limits] = await Promise.all([
    db().integration.findMany({
      where: { credential: { isNot: null } },
      select: { provider: true, lastError: true },
      orderBy: { provider: 'asc' },
    }),
    thresholds(),
  ]);
  if (integrations.length === 0) return [];

  const staleHours = limits['sync.staleHours'];
  const brokenHours = limits['sync.failedHours'];

  const runs = await db().syncRun.findMany({
    where: { provider: { in: integrations.map((i: { provider: string }) => i.provider) } },
    select: { provider: true, status: true, rows: true, startedAt: true, finishedAt: true, error: true },
    orderBy: { startedAt: 'desc' },
    // Enough to give every provider its window even when one of them dominates the log.
    take: WINDOW * Math.max(1, integrations.length),
  });

  const byProvider = new Map<string, typeof runs>();
  for (const run of runs) {
    const list = byProvider.get(run.provider) ?? [];
    if (list.length < WINDOW) list.push(run);
    byProvider.set(run.provider, list);
  }

  return integrations.map((integration) => {
    const definition = getProvider(integration.provider);
    const recent = byProvider.get(integration.provider) ?? [];
    const succeeded = recent.filter((r) => r.status === 'succeeded');
    const lastSuccess = succeeded[0] ?? null;
    const since = lastSuccess ? hours(lastSuccess.finishedAt ?? lastSuccess.startedAt, now) : null;

    // A provider with no history is not called broken. The table is new; it has simply
    // not run since the deploy, and asserting a fault from an absence of evidence is how
    // a panel trains people to ignore it.
    const freshness: Freshness =
      recent.length === 0
        ? 'fresh'
        : since === null || since >= brokenHours
          ? 'broken'
          : since >= staleHours
            ? 'stale'
            : 'fresh';

    return {
      provider: integration.provider,
      name: definition?.name ?? integration.provider,
      freshness,
      lastSuccessAt: lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null,
      hoursSinceSuccess: since === null ? null : Math.floor(since),
      lastError: recent[0]?.status === 'failed' ? (recent[0].error ?? integration.lastError) : integration.lastError,
      recentFailures: recent.filter((r) => r.status === 'failed').length,
      recentRuns: recent.length,
      medianRows: median(succeeded.map((r) => r.rows)),
      noHistory: recent.length === 0,
      ownSchedule: definition?.ownSchedule === true,
    };
  });
}

/**
 * A run still marked `running` long after any run could legitimately live.
 *
 * That is a process the platform killed mid-flight — the one failure mode that writes no
 * error, because nothing survived to write one. Twice the sync route's 300-second
 * ceiling, so a slow run is never mistaken for a dead one.
 */
const ABANDONED_MS = 10 * 60 * 1000;

/**
 * The recent runs, newest first — the run history §16 asks for.
 *
 * `provider` omitted gives every provider's runs interleaved, which is what the Analytics
 * panel wants: the question there is "has anything been failing", not "how is this one
 * doing".
 *
 * The clock is read once here rather than per row in the component. A component is
 * supposed to be pure, and a clock called inside a map can classify two rows of the same
 * table against two different instants.
 */
export async function runHistory(provider?: string, take = 30) {
  const now = Date.now();
  const rows = await db().syncRun.findMany({
    where: provider ? { provider } : undefined,
    orderBy: { startedAt: 'desc' },
    take,
    select: {
      id: true,
      provider: true,
      status: true,
      rows: true,
      durationMs: true,
      detail: true,
      error: true,
      complete: true,
      actorEmail: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    abandoned: row.status === 'running' && now - row.startedAt.getTime() > ABANDONED_MS,
  }));
}

export type SyncRunRow = Awaited<ReturnType<typeof runHistory>>[number];
