import { CircleCheck } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { PriorityBadge } from '@/components/patterns/badges';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { db, hasDb } from '@/lib/prisma';
import { pageQuery } from '@/lib/query';
import { listAssignable, peopleOn, personOptions } from '@/lib/users';
import { TASK_KINDS, TASK_STATUSES, taskKind, taskKindWhere } from '@/lib/enums';
import { ProgressLink } from '@/components/NavProgress';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { sourceMeta } from '@/lib/sources';
import { taskLoad } from '@/lib/scorecard';
import { CompleteButton } from './CompleteButton';

export const metadata = { title: 'Tasks · Growth Center' };

export default function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Everything outstanding across the CRM, newest deadlines last."
      />
      <Suspense fallback={<PageSkeleton headless />}>
        <TasksBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TasksBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) return <Card><NoDatabaseState /></Card>;

  const params = await searchParams;
  const [people, assignees] = await Promise.all([listAssignable(), peopleOn('task', 'assigneeEmail')]);
  const q = pageQuery(params);
  const status = typeof params.status === 'string' ? params.status : '';
  const assignee = typeof params.assigneeEmail === 'string' ? params.assigneeEmail : '';
  const kind = typeof params.kind === 'string' ? params.kind : '';

  // Everything except the kind. Kept separate so the per-kind counts below can reuse the
  // exact scope the table is showing — if they were computed against a different `where`,
  // the tab could say 42 over a list of 11 and neither number would be wrong.
  const scope: Record<string, unknown> = {};
  if (status) scope.status = status;
  else scope.status = { in: ['open', 'in_progress'] };
  if (assignee) scope.assigneeEmail = assignee === 'unassigned' ? null : assignee;
  if (q.q) scope.title = { contains: q.q, mode: 'insensitive' };

  // §19.1's split. Derived from `source`, never a stored column — see taskKind.
  const where = { ...scope, ...(taskKindWhere(kind) ?? {}) };

  const filtered = Boolean(status || assignee || q.q || kind);

  // §19.2's "older than 90 days". Built from a Date rather than Date.now() because a
  // component has to be pure and the linter is right that a bare clock read inside one
  // can give two answers in one render.
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

  const [rows, total, everything] = await Promise.all([
    db().task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        opportunity: { select: { id: true, name: true } },
      },
    }),
    db().task.count({ where }),
    // The unfiltered count, so an empty result can tell "you have no tasks" apart from
    // "your filter matches none". `total` is the filtered count and answers neither:
    // choosing Cancelled — a status this CRM never uses — used to say tasks would appear
    // once a lead was qualified, with 6,228 of them sitting behind the filter.
    filtered ? db().task.count() : Promise.resolve(0),
  ]);

  // How much unfinished work sits on each side of the split. Counted on the same status
  // window the page is showing, not over the whole table — a "Delivery 42" beside a list
  // of open tasks must mean 42 open ones, or the number is a different question wearing
  // the same label.
  const [crmCount, deliveryCount, ageing, oldest, load] = await Promise.all([
    db().task.count({ where: { ...scope, ...taskKindWhere('crm') } }),
    db().task.count({ where: { ...scope, ...taskKindWhere('delivery') } }),
    // §19.2's hygiene metric: "tasks older than 90 days", shown until it reaches zero.
    //
    // Age from creation, not from the due date. A task re-dated forward is not younger —
    // re-dating is the commonest way a board stops carrying signal, and measuring the due
    // date would make the metric fall every time somebody pushed a date rather than every
    // time somebody finished something.
    db().task.count({ where: { ...where, createdAt: { lt: ninetyDaysAgo } } }),
    db().task.findFirst({
      where,
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    taskLoad(),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <FilterBar
        searchPlaceholder="Task title…"
        filters={[
          {
            name: 'status',
            label: 'Status',
            // Untouched, this page shows unfinished work only — so the empty option must
            // not read "all" over a table with 1,518 completed tasks hidden from it.
            allLabel: 'Status: open & in progress',
            options: TASK_STATUSES.map((s) => ({ value: s, label: s.replaceAll('_', ' ') })),
          },
          {
            name: 'kind',
            label: 'Kind',
            // Not "all": the two are genuinely different work and the default showing
            // both is a choice, not an absence of one.
            allLabel: `Both (${crmCount + deliveryCount})`,
            options: TASK_KINDS.map((k) => ({
              value: k,
              label: k === 'crm' ? `CRM follow-up (${crmCount})` : `Delivery (${deliveryCount})`,
            })),
          },
          {
            name: 'assigneeEmail',
            label: 'Assignee',
            // The roster AND whoever the records are actually assigned to. Almost every
            // task here belongs to someone with no account in this app.
            options: [{ value: 'unassigned', label: 'Unassigned' }, ...personOptions(people, assignees)],
          },
        ]}
      />

      {/* §19.2's hygiene metric. "4,802 open tasks means the task system carries no
          signal. Nothing built on top of it will either." Shown until it reaches zero and
          then gone, which is the whole design of the clause — a metric that stays on
          screen after it is solved becomes furniture. */}
      {ageing > 0 ? (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-xs text-warning-strong">
          <span className="font-semibold tnum">{fmtNumber(ageing)}</span> of {fmtNumber(total)} open
          tasks are more than 90 days old
          {oldest ? <>, the oldest raised {fmtRelative(oldest.createdAt)}</> : null}. Age is measured
          from when the task was raised, not from its due date — re-dating a task forward does not
          make it younger, and it is the commonest way a board stops carrying signal.
        </div>
      ) : null}

      {/* §19.4's "overdue counts by owner". The per-task-type SLA the clause also asks
          for needs a task type, and neither Zoho CRM nor Zoho Projects sends one this app
          can read — every imported task is a title and a due date. So this reports what
          the data supports rather than inventing a classification to hang three
          thresholds off. */}
      {load.length > 0 ? (
        <Card className="mb-4 overflow-hidden">
          <CardHeader>
            <CardTitle>Open work by owner</CardTitle>
          </CardHeader>
          <TableWrap>
            <Table className="min-w-[520px]">
              <THead>
                <TR>
                  <TH>Owner</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Overdue</TH>
                  <TH className="text-right">Over 90 days</TH>
                  <TH className="text-right">Oldest</TH>
                </TR>
              </THead>
              <TBody>
                {load.slice(0, 12).map((r) => (
                  <TR key={r.assigneeEmail ?? 'unassigned'}>
                    <TD className={r.assigneeEmail ? 'font-medium' : 'font-medium text-muted-foreground'}>
                      {r.name}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(r.open)}</TD>
                    <TD className={`text-right tnum ${r.overdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {fmtNumber(r.overdue)}
                    </TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(r.ageing)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {r.oldestDays === null ? '—' : `${fmtNumber(r.oldestDays)}d`}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CircleCheck className="size-6" />}
            title="Nothing to do"
            hint={
              filtered
                ? everything > 0
                  ? 'No task matches these filters. Clear them to see the rest.'
                  : 'Tasks arrive from the CRM and from Zoho Projects, or when someone adds one to a record.'
                : 'Nothing open. Finished tasks are behind the status filter.'
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Task</TH>
                    <TH>Related to</TH>
                    <TH>Priority</TH>
                    <TH>Assignee</TH>
                    <TH className="text-right">Due</TH>
                    <TH className="text-right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((t) => {
                    const overdue = t.dueDate && t.dueDate < today && t.status !== 'done';
                    return (
                      <TR key={t.id}>
                        <TD>
                          <div className="flex items-baseline gap-2">
                            <p className="font-medium">{t.title}</p>
                            {/* Only on delivery work. Badging all 6,392 CRM rows with the
                                same word is noise; the badge exists to mark the minority
                                that is not what this list has always been. */}
                            {taskKind(t.source) === 'delivery' ? (
                              <Badge tone="neutral">{sourceMeta(t.source).label}</Badge>
                            ) : null}
                          </div>
                          {t.detail ? <p className="text-meta text-muted-foreground">{t.detail}</p> : null}
                        </TD>
                        <TD className="text-muted-foreground">
                          {t.lead ? (
                            <ProgressLink href={`/leads/${t.lead.id}`} className="hover:text-primary">
                              {[t.lead.firstName, t.lead.lastName].filter(Boolean).join(' ')}
                            </ProgressLink>
                          ) : t.opportunity ? (
                            <ProgressLink href={`/pipeline/${t.opportunity.id}`} className="hover:text-primary">
                              {t.opportunity.name}
                            </ProgressLink>
                          ) : t.contact ? (
                            <ProgressLink href={`/crm/contacts/${t.contact.id}`} className="hover:text-primary">
                              {[t.contact.firstName, t.contact.lastName].filter(Boolean).join(' ')}
                            </ProgressLink>
                          ) : t.company ? (
                            <ProgressLink href={`/crm/companies/${t.company.id}`} className="hover:text-primary">
                              {t.company.name}
                            </ProgressLink>
                          ) : (
                            '—'
                          )}
                        </TD>
                        <TD><PriorityBadge priority={t.priority} /></TD>
                        <TD className="text-muted-foreground">
                          {t.assigneeEmail ? t.assigneeEmail.split('@')[0] : 'Unassigned'}
                        </TD>
                        <TD className="text-right">
                          {t.dueDate ? (
                            overdue ? (
                              <Badge tone="danger">{fmtDate(t.dueDate)}</Badge>
                            ) : (
                              <span className="text-muted-foreground">{fmtDate(t.dueDate)}</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          {t.status === 'done' ? (
                            <span className="inline-flex items-center gap-2">
                              <Badge tone="success">done</Badge>
                              <CompleteButton taskId={t.id} done />
                            </span>
                          ) : (
                            <CompleteButton taskId={t.id} />
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
            <Pager page={q.page} perPage={q.perPage} total={total} />
          </>
        )}
      </Card>
    </>
  );
}
