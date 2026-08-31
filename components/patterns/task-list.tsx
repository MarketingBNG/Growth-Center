import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PriorityBadge } from '@/components/patterns/badges';
import { fmtDate } from '@/lib/format';

type TaskRow = {
  id: string;
  title: string;
  priority: string;
  dueDate: Date | null;
  assigneeEmail: string | null;
};

/**
 * The open tasks standing against one record.
 *
 * Lifted out of the lead detail page because the company and contact pages fetched their
 * tasks and then never rendered them — 1,071 tasks against companies and 457 against
 * contacts were being read from the database and dropped on the floor, so the only place
 * they were visible was the Tasks module.
 *
 * Renders nothing when there are none, so a caller can drop it into a column without
 * guarding it.
 */
export function TaskList({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open tasks ({tasks.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-snug">{t.title}</p>
              <PriorityBadge priority={t.priority as never} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t.dueDate ? `Due ${fmtDate(t.dueDate)}` : 'No due date'}
              {t.assigneeEmail ? ` · ${t.assigneeEmail.split('@')[0]}` : ''}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
