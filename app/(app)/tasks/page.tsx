import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { PriorityBadge } from '@/components/patterns/badges';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { db, hasDb } from '@/lib/prisma';
import { pageQuery } from '@/lib/query';
import { listAssignable } from '@/lib/users';
import { TASK_STATUSES } from '@/lib/enums';
import { fmtDate } from '@/lib/format';
import { CompleteButton } from './CompleteButton';

export const metadata = { title: 'Tasks · Growth Center' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Tasks" subtitle="Follow-ups across leads, deals and accounts." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const params = await searchParams;
  const people = await listAssignable();
  const q = pageQuery(params);
  const status = typeof params.status === 'string' ? params.status : '';
  const assignee = typeof params.assigneeEmail === 'string' ? params.assigneeEmail : '';

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  else where.status = { in: ['open', 'in_progress'] };
  if (assignee) where.assigneeEmail = assignee === 'unassigned' ? null : assignee;
  if (q.q) where.title = { contains: q.q, mode: 'insensitive' };

  const [rows, total] = await Promise.all([
    db().task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        opportunity: { select: { id: true, name: true } },
      },
    }),
    db().task.count({ where }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Created by hand, or automatically when a lead is qualified."
      />

      <FilterBar
        searchPlaceholder="Task title…"
        filters={[
          { name: 'status', label: 'Status', options: TASK_STATUSES.map((s) => ({ value: s, label: s.replaceAll('_', ' ') })) },
          {
            name: 'assigneeEmail',
            label: 'Assignee',
            options: [
              { value: 'unassigned', label: 'Unassigned' },
              ...people.map((a) => ({ value: a.email, label: a.name })),
            ],
          },
        ]}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CircleCheck className="size-6" />}
            title="Nothing to do"
            hint={total === 0 ? 'Tasks appear here when a lead is qualified, or when someone adds one to a record.' : 'Clear the filters to see the rest.'}
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
                            <Link href={`/leads/${t.lead.id}`} className="hover:text-primary">
                              {[t.lead.firstName, t.lead.lastName].filter(Boolean).join(' ')}
                            </Link>
                          ) : t.opportunity ? (
                            <Link href={`/pipeline/${t.opportunity.id}`} className="hover:text-primary">
                              {t.opportunity.name}
                            </Link>
                          ) : t.company ? (
                            <Link href={`/crm/companies/${t.company.id}`} className="hover:text-primary">
                              {t.company.name}
                            </Link>
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
