import { Send, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { SourceBadge } from '@/components/patterns/source-badge';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { hasDb } from '@/lib/prisma';
import { SEQUENCE_STATUSES, sequenceFilters, sequences } from '@/lib/outreach';
import { pageQuery, pick } from '@/lib/query';
import { DEMO_SOURCE, sourceMeta } from '@/lib/sources';
import { emailStatus } from '@/lib/email';
import { fmtNumber, fmtPercent, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Outreach · Growth Center' };

const STATUS_TONE = {
  pending: 'neutral',
  active: 'info',
  replied: 'success',
  bounced: 'danger',
  unsubscribed: 'warning',
  completed: 'neutral',
} as const;

const FILTERS = [
  { name: 'status', label: 'Status', options: SEQUENCE_STATUSES.map((v) => ({ value: v, label: v })) },
  { name: 'source', label: 'Source', options: [{ value: 'smartlead', label: sourceMeta('smartlead').label }] },
];

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Outreach" subtitle="Sequences, prospects and replies." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  // Ten to a page, not the shared default of twenty-five: a row on this page is a whole
  // campaign with its steps, so twenty-five of them is the scroll this pager exists to
  // end. An explicit ?perPage= still wins.
  const q = pageQuery({ perPage: '10', ...params });
  const filters = sequenceFilters.parse(pick(params, ['status', 'source']));
  const filtered = Boolean(filters.status || filters.source || q.q);
  const [{ rows: list, total }, email] = await Promise.all([
    sequences(filters, q),
    Promise.resolve(emailStatus()),
  ]);

  return (
    <>
      <PageHeader title="Outreach" subtitle="Sequences, prospects and replies." />

      {/* The provider's own honesty, surfaced. Nothing is sent, and the page says so
          rather than letting "sent" rows imply delivery. */}
      <div
        className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 ${
          email.sends ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10'
        }`}
      >
        <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${email.sends ? 'text-success' : 'text-warning'}`} />
        <p className={`text-xs ${email.sends ? 'text-success' : 'text-warning'}`}>
          Provider: <span className="font-mono">{email.providerId}</span>. {email.detail}
        </p>
      </div>

      <FilterBar filters={FILTERS} searchPlaceholder="Sequence name…" />

      {list.length === 0 ? (
        <Card>
          {/* Three different nothings, and they need different sentences: no campaigns at
              all, none matching the filters, and a ?page= past the end — where telling the
              reader to clear filters they never set explains nothing. */}
          <EmptyState
            icon={<Send className="size-6" />}
            title={total === 0 ? 'No sequences yet' : 'Nothing on this page'}
            hint={
              total === 0
                ? 'Connect Smartlead on the Integrations page to import your campaigns.'
                : filtered
                  ? 'No sequence matches these filters. Clear them to see the rest.'
                  : `There are ${fmtNumber(total)} sequences, but none on page ${q.page}.`
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="flex items-center gap-1.5">
                      <CardTitle>{s.name}</CardTitle>
                      <SourceBadge source={s.source ?? DEMO_SOURCE} />
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {plural(s.steps.length, 'step')} · {plural(s.prospects, 'prospect')}
                      {s.ownerEmail ? ` · ${s.ownerEmail.split('@')[0]}` : ''} · created{' '}
                      {fmtRelative(s.createdAt)}
                      {/* §14.2 wants copy approved by, and numbers verified by, as
                          properties of the sequence. Neither field exists yet, so the
                          honest statement is that there is no approval — not silence,
                          which reads as approved. */}
                      {' · '}
                      <span className="text-destructive">Approval: none on record</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Template checks before status, because "not fit to send" outranks
                        "paused" when someone is deciding what to start next. */}
                    {s.lint.critical > 0 ? (
                      <Badge tone="danger">
                        not fit to send · {plural(s.lint.critical, 'issue')}
                      </Badge>
                    ) : null}
                    {s.lint.review > 0 ? (
                      <Badge tone="warning">{s.lint.review} to verify</Badge>
                    ) : null}
                    <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {fmtPercent(s.replyRate)} reply rate
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* What the platform reports it actually did. Absent for a sequence this
                    app owns, and for a campaign that has not started sending. */}
                {s.sending ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    <Sent label="Sent" value={s.sending.sent} />
                    <Sent label="Opened" value={s.sending.opened} note={fmtPercent(s.sending.openRate)} />
                    <Sent label="Clicked" value={s.sending.clicked} />
                    <Sent label="Replied" value={s.sending.replied} />
                    <Sent label="Bounced" value={s.sending.bounced} />
                    <Sent label="Unsub" value={s.sending.unsubscribed} />
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(s.byStatus).map(([status, count]) => (
                    <Badge key={status} tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                      {status} {count}
                    </Badge>
                  ))}
                </div>

                <div className="space-y-2">
                  {/* Numbered by order, not by `position`: Smartlead's positions start at
                      1, so adding one printed a one-step sequence as step 2. */}
                  {s.steps.map((step, i) => (
                    <div key={step.id} className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="grid size-5 shrink-0 place-items-center rounded bg-secondary text-[11px] font-semibold">
                          {i + 1}
                        </span>
                        {/* A follow-up in the same thread carries no subject, and 38 of
                            these steps stored "" rather than null — which is not null, so
                            the fallback never fired and the row was headed by a blank. */}
                        <p className={`text-xs font-medium ${step.subject ? '' : 'text-muted-foreground'}`}>
                          {step.subject ?? '(no subject)'}
                        </p>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {step.waitDays === 0 ? 'immediately' : `wait ${step.waitDays}d`} · {step.channel}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap pl-7 text-[11px] leading-relaxed text-muted-foreground">
                        {step.body}
                      </p>
                      {/* Findings sit against the step that carries them, so fixing one
                          does not mean hunting through the template for the line. */}
                      {s.lint.findings
                        .filter((f) => f.stepPosition === step.position)
                        .map((f, n) => (
                          <p
                            key={`${f.code}-${n}`}
                            className={`mt-1 flex items-start gap-1.5 pl-7 text-[11px] ${
                              f.severity === 'critical' ? 'text-destructive' : 'text-warning'
                            }`}
                          >
                            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                            <span>
                              {f.message}
                              <span className="text-muted-foreground"> — in the {f.field}</span>
                            </span>
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="overflow-hidden">
            <Pager page={q.page} perPage={q.perPage} total={total} />
          </Card>
        </div>
      )}
    </>
  );
}

function plural(n: number, noun: string): string {
  return `${fmtNumber(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/** One reported total. Deliberately plain — six of these sit in a row and a card each
 *  would out-shout the sequence they describe. */
function Sent({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{fmtNumber(value)}</p>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
