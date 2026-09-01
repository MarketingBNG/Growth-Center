import { CircleCheck } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { PriorityBadge } from '@/components/patterns/badges';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { db, hasDb } from '@/lib/prisma';
import { pageQuery } from '@/lib/query';
import { listAssignable, peopleOn, personOptions } from '@/lib/users';
import { TASK_STATUSES } from '@/lib/enums';
import { ProgressLink } from '@/components/NavProgress';
import { fmtDate } from '@/lib/format';
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

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  else where.status = { in: ['open', 'in_progress'] };
  if (assignee) where.assigneeEmail = assignee === 'unassigned' ? null : assignee;
  if (q.q) where.title = { contains: q.q, mode: 'insensitive' };

  const filtered = Boolean(status || assignee || q.q);

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
            name: 'assigneeEmail',
            label: 'Assignee',
            // The roster AND whoever the records are actually assigned to. Almost every
            // task here belongs to someone with no account in this app.
            options: [{ value: 'unassigned', label: 'Unassigned' }, ...personOptions(people, assignees)],
          },
        ]}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CircleCheck className="size-6" />}
            title="Nothing to do"
            hint={
              filtered
                ? everything > 0
                  ? 'No task matches these filters. Clear them to see the rest.'
                  : 'Tasks arrive with the CRM sync, or when someone adds one to a record.'
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
                          <p className="font-medium">{t.title}</p>
                          {t.detail ? <p className="text-[11px] text-muted-foreground">{t.detail}</p> : null}
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
