import type { IntegrationProvider, MetricPoint } from '../types.ts';
import { bulkUpsert, meta, str } from '../persist.ts';

/**
 * Turns `work_task` points into Task rows.
 *
 * Kept apart from `writeCrmActivity`, which builds the CRM's tasks, because the two are
 * different kinds of work that happen to share a table: a CRM task is "call this lead", a
 * Projects task is "ship this feature". They coexist safely on `@@unique([source,
 * externalId])` — 6,392 rows carry `zoho_crm` and these carry `zoho_projects` — and the
 * `source` column is what lets the Tasks page tell them apart, which §19.1 asks for.
 *
 * None of the CRM relation columns are set. A Projects task is about a project, not about
 * a lead or a deal, and guessing a link from a title would be a fabricated association.
 */
export async function writeWorkTasks(provider: IntegrationProvider, points: MetricPoint[]): Promise<number> {
  const taskPoints = points.filter((p) => p.entityType === 'work_task' && p.entityId);
  if (!taskPoints.length) return 0;

  const rows = taskPoints.map((p) => {
    const m = meta(p);
    const due = str(m.dueDate);
    const completed = str(m.completedAt);
    return [
      p.entityLabel ?? 'Untitled task',
      // The project and list the task lives in, plus Zoho's own status and priority
      // wording. `detail` is the only place a reader sees where a task came from, and
      // "Marketing_SGS_Zoho · General" is the difference between a queue and a list.
      [str(m.projectName), str(m.tasklistName)].filter(Boolean).join(' · ') || null,
      str(m.status) ?? 'open',
      str(m.priority) ?? 'normal',
      due,
      str(m.assigneeEmail),
      str(m.createdByEmail),
      completed,
      p.entityId,
      provider.id,
    ];
  });

  const touched = await bulkUpsert(
    'task',
    [
      'title',
      'detail',
      'status',
      'priority',
      'dueDate',
      'assigneeEmail',
      'createdByEmail',
      'completedAt',
      'externalId',
      'source',
    ],
    rows,
    '"source", "externalId"',
    // Quoted enum names and timestamp(3), matching the CRM task writer exactly. Prisma
    // creates these enum types case-sensitively, so an unquoted `TaskStatus` is folded to
    // lowercase by Postgres and the cast fails at runtime rather than at typecheck.
    { status: '"TaskStatus"', priority: '"Priority"', dueDate: 'timestamp(3)', completedAt: 'timestamp(3)' },
  );

  return touched.length;
}
