import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/state';
import { History } from 'lucide-react';
import { runHistory } from '@/lib/sync-health';
import { getProvider } from '@/lib/integrations/registry';
import { fmtNumber, fmtRelative } from '@/lib/format';

// §16's run history, on the page that already answers "where did this number come from".
//
// The Data sources card above says which integration wrote a series. This says whether it
// has been writing them successfully, which is the other half of the same question and
// the one nothing in the app could previously answer: `lastSyncAt` is overwritten by
// every run, so six consecutive failures followed by one success left no trace at all.

const TONE: Record<string, string> = {
  succeeded: 'text-success',
  failed: 'text-destructive',
  running: 'text-warning-strong',
};

export async function SyncRuns({ take = 25 }: { take?: number }) {
  const runs = await runHistory(undefined, take);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Recent syncs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Every attempt, successful or not. The history starts at the first run after this was
          deployed — before that only the most recent run of each provider was kept, so a
          provider that failed all week and then succeeded looked like one that never failed.
        </p>
      </CardHeader>
      {runs.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No runs recorded yet"
          hint="The nightly cron writes one row per provider per run. The first will appear after it next runs."
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[820px]">
            <THead>
              <TR>
                <TH>Provider</TH>
                <TH>Started</TH>
                <TH>Outcome</TH>
                <TH className="text-right">Rows</TH>
                <TH className="text-right">Took</TH>
                <TH>Detail</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((run) => {
                // `abandoned` is decided in the data layer, against one instant for the
                // whole table — see runHistory.
                const abandoned = run.abandoned;
                return (
                  <TR key={run.id}>
                    <TD className="font-medium">{getProvider(run.provider)?.name ?? run.provider}</TD>
                    <TD className="text-muted-foreground">
                      {fmtRelative(run.startedAt)}
                      {/* Null actor is the cron. Named rather than left blank, because
                          "who started this" is the first question asked of a run that
                          overlapped another one. */}
                      <span className="ml-1 text-[11px]">
                        · {run.actorEmail ?? 'scheduled'}
                      </span>
                    </TD>
                    <TD className={TONE[run.status] ?? 'text-muted-foreground'}>
                      {abandoned ? 'killed mid-run' : run.status}
                      {run.status === 'succeeded' && !run.complete ? (
                        <span className="ml-1 text-muted-foreground">· more to fetch</span>
                      ) : null}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(run.rows)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)}s`}
                    </TD>
                    <TD className="max-w-[380px] truncate text-muted-foreground" title={run.error ?? run.detail ?? ''}>
                      {run.error ? (
                        <span className="text-destructive">{run.error}</span>
                      ) : abandoned ? (
                        'The run never finished. A serverless function that hits its ceiling is stopped without an error to record.'
                      ) : (
                        (run.detail ?? '—')
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
