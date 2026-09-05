import Link from 'next/link';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
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

export async function ActionQueue({ take = 6 }: { take?: number }) {
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

  const queue = [...rows]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity ?? 'info'] ?? 3) - (SEVERITY_RANK[b.severity ?? 'info'] ?? 3) ||
        (a.firstSeenAt ?? a.createdAt).getTime() - (b.firstSeenAt ?? b.createdAt).getTime(),
    )
    .slice(0, take);

  const unowned = rows.filter((r) => r.ownerEmail === null).length;

  return (
    <Card className="mb-[18px] overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Action queue</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length === 0
              ? 'Nothing waiting on a decision.'
              : `${rows.length} open${unowned > 0 ? `, ${unowned} with no owner` : ''}. Worst first, then longest waiting.`}
          </p>
        </div>
        <Link
          href="/ai"
          className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Work the queue <ArrowRight className="size-3" />
        </Link>
      </CardHeader>

      {queue.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-xs text-muted-foreground">
          <ListChecks className="size-4 shrink-0" />
          The rules ran and raised nothing that needs a decision.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {queue.map((row) => {
            const status = (row.status as InsightStatus) ?? 'proposed';
            const waiting = row.firstSeenAt ?? row.createdAt;
            return (
              <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className={`mt-[7px] size-2 shrink-0 rounded-full ${SEVERITY_TONE[row.severity ?? 'info'] ?? 'bg-border'}`}
                />
                <div className="min-w-0 flex-1">
                  <Link href="/ai" className="text-xs font-medium hover:text-primary">
                    {row.title}
                  </Link>
                  {/* The action, not the analysis. A row with no proposed action is a row
                      nobody can work, and saying so is more useful than leaving it blank. */}
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {row.proposedAction ?? 'No action proposed yet.'}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px]">
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
    </Card>
  );
}
