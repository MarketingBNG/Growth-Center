import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { syncHealth, type Freshness } from '@/lib/sync-health';
import { fmtNumber, fmtRelative } from '@/lib/format';
import { thresholds } from '@/lib/settings';

// G5.2: the freshness panel, with the two thresholds the manual asks for.
//
// The `sync_stale_or_failed` rule already fired at 24 hours, but a rule writes a finding
// into the digest — it does not answer "is the data on this screen current?" for somebody
// standing in front of the screen. And it had one threshold, so a run missed overnight
// and a system that stopped two days ago produced the same finding at the same severity.

const TONE: Record<Freshness, { dot: string; text: string; label: string }> = {
  fresh: { dot: 'bg-success', text: 'text-muted-foreground', label: 'Current' },
  // Amber is deliberately not a warning colour on the text as well as the dot. A missed
  // night is worth seeing and not worth alarming about, and a panel that shouts at every
  // amber gets ignored by the time it turns red.
  stale: { dot: 'bg-warning', text: 'text-muted-foreground', label: 'A run was missed' },
  broken: { dot: 'bg-destructive', text: 'text-destructive', label: 'Stopped' },
};

export async function SyncHealth() {
  const [rows, limits] = await Promise.all([syncHealth(), thresholds()]);
  if (rows.length === 0) return null;

  // Sorted worst-first. A panel listing eleven providers alphabetically buries the one
  // that broke, which is the only row anybody opened it to find.
  const order: Record<Freshness, number> = { broken: 0, stale: 1, fresh: 2 };
  const sorted = [...rows].sort(
    (a, b) => order[a.freshness] - order[b.freshness] || a.name.localeCompare(b.name),
  );

  const broken = rows.filter((r) => r.freshness === 'broken').length;
  const stale = rows.filter((r) => r.freshness === 'stale').length;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Data freshness</CardTitle>
        <p className="text-xs text-muted-foreground">
          {broken || stale
            ? `${broken ? `${broken} stopped` : ''}${broken && stale ? ', ' : ''}${stale ? `${stale} missed a run` : ''}. Amber after ${limits['sync.staleHours']}h without a successful sync, red after ${limits['sync.failedHours']}h.`
            : `Every connected provider has synced successfully inside ${limits['sync.staleHours']} hours.`}
        </p>
      </CardHeader>
      <ul className="divide-y divide-border border-t border-border">
        {sorted.map((row) => {
          const tone = TONE[row.freshness];
          return (
            <li key={row.provider} className="flex items-center gap-3 px-4 py-2.5 text-xs">
              <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
              <span className="w-40 shrink-0 font-medium">{row.name}</span>
              <span className={`flex-1 ${tone.text}`}>
                {row.noHistory ? (
                  // An absence of records is not a record of absence. This table starts
                  // empty, and rendering that as a clean bill of health is how a panel
                  // earns the trust it has not yet done anything to deserve.
                  <>No run recorded yet — the log starts at the first sync after deploy.</>
                ) : row.lastSuccessAt ? (
                  <>
                    {tone.label} · last succeeded {fmtRelative(row.lastSuccessAt)}
                    {row.medianRows !== null ? (
                      <> · {fmtNumber(row.medianRows)} rows in a typical run</>
                    ) : null}
                  </>
                ) : (
                  <>Has not succeeded once in its last {row.recentRuns} runs.</>
                )}
                {row.recentFailures > 0 ? (
                  // The ratio, not a streak. A provider that fails every other night is
                  // broken in a way a counter that keeps resetting will never show.
                  <> · {row.recentFailures} of the last {row.recentRuns} runs failed</>
                ) : null}
                {row.ownSchedule ? <> · runs on its own schedule</> : null}
              </span>
              {row.lastError ? (
                <span className="max-w-[38%] truncate text-destructive" title={row.lastError}>
                  {row.lastError}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
