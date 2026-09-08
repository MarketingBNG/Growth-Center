import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { ActionQueueDrawer } from './ActionQueueDrawer';
import { db } from '@/lib/prisma';
import { STATUS_LABELS, type InsightStatus } from '@/lib/insight-lifecycle';
import { fmtRelative } from '@/lib/format';

// §6.3: "Move AI insights to the top and render as an action queue — each row an insight,
// a proposed action, an owner and a status. Not paragraphs."
//
// "This is the change the whole document exists for. A paragraph is read once; a row with
// an owner is worked."
//
// So the model's two sentences of narration are deliberately **not rendered here**. They
// are on /ai, where somebody reading one finding closely wants them. On the morning screen
// the prose is what makes the widget skimmable-past: five paragraphs of well-written
// analysis and no column that says whose job it is.

/** Worst first, then longest waiting — the same order the digest and the weekly pack use,
 *  so the three cannot disagree about what matters this morning. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-destructive',
  high: 'bg-destructive/70',
  medium: 'bg-warning',
  info: 'bg-border',
};

/** Only the states that mean nobody is on it yet get the muted treatment. */
const UNOWNED: InsightStatus[] = ['proposed', 'reviewed'];

export async function ActionQueue({ take = 12 }: { take?: number }) {
  const rows = await db().aiInsight.findMany({
    // Resolved as well as dismissed: a finding the last run stopped reporting is kept for
    // its history, not because it is still true, and this asserts what is true now.
    where: { dismissedAt: null, resolvedAt: null, status: { not: 'done' } },
    select: {
      id: true,
      title: true,
      proposedAction: true,
      ownerEmail: true,
      status: true,
      severity: true,
      firstSeenAt: true,
      createdAt: true,
    },
  });

  const sorted = [...rows].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity ?? 'info'] ?? 3) - (SEVERITY_RANK[b.severity ?? 'info'] ?? 3) ||
      (a.firstSeenAt ?? a.createdAt).getTime() - (b.firstSeenAt ?? b.createdAt).getTime(),
  );

  // The rules raise one finding per offending record, so a template problem that affects
  // three sequences arrives as three rows that are word-for-word identical and carry the
  // same decision. Shown separately they push the numbers off the screen and read as
  // three problems. Collapsed with a count they read as the one problem they are — and
  // the count is the part that says how much work it is.
  //
  // Grouped on the wording AND the owner AND the status: two rows that say the same thing
  // but sit with different people are two pieces of work, not one, and merging them would
  // hide a name.
  const groups: { row: (typeof sorted)[number]; count: number }[] = [];
  const seen = new Map<string, number>();
  for (const row of sorted) {
    const k = JSON.stringify([row.title, row.proposedAction, row.ownerEmail, row.status]);
    const at = seen.get(k);
    if (at === undefined) {
      seen.set(k, groups.length);
      // The first of a group is the worst and longest-waiting of it, the list being
      // sorted already, so the row that represents the group is the one that set its
      // place in the queue.
      groups.push({ row, count: 1 });
    } else {
      groups[at].count += 1;
    }
  }

  const queue = groups.slice(0, take);

  const unowned = rows.filter((r) => r.ownerEmail === null).length;
  // The worst severity still open, so the button can colour its count. Read off the
  // sorted list rather than recomputed: the first row is the worst by construction.
  const worst = sorted[0]?.severity ?? null;

  return (
    <ActionQueueDrawer count={rows.length} unowned={unowned} worst={worst}>
      {queue.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <ListChecks className="size-4 shrink-0" />
          The rules ran and raised nothing that needs a decision.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {queue.map(({ row, count }) => {
            const status = (row.status as InsightStatus) ?? 'proposed';
            const waiting = row.firstSeenAt ?? row.createdAt;
            return (
              <li key={row.id} className="flex items-start gap-3 py-2.5">
                <span
                  aria-hidden
                  className={`mt-[7px] size-2 shrink-0 rounded-full ${SEVERITY_TONE[row.severity ?? 'info'] ?? 'bg-border'}`}
                />
                <div className="min-w-0 flex-1">
                  <Link href="/ai" className="text-xs font-medium hover:text-primary">
                    {row.title}
                  </Link>
                  {count > 1 ? (
                    <span
                      className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-micro font-bold tnum text-muted-foreground"
                      title={`${count} records raise this same finding`}
                    >
                      ×{count}
                    </span>
                  ) : null}
                  {/* The action, not the analysis. A row with no proposed action is a row
                      nobody can work, and saying so is more useful than leaving it blank. */}
                  <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">
                    {row.proposedAction ?? 'No action proposed yet.'}
                  </p>
                </div>
                <div className="shrink-0 text-right text-meta">
                  <p className={row.ownerEmail ? 'font-medium' : 'text-muted-foreground'}>
                    {row.ownerEmail ? row.ownerEmail.split('@')[0] : 'Unowned'}
                  </p>
                  <p className={UNOWNED.includes(status) ? 'text-muted-foreground' : 'text-foreground'}>
                    {STATUS_LABELS[status] ?? status} · {fmtRelative(waiting)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ActionQueueDrawer>
  );
}
