'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

/**
 * The action queue, behind a button in the page header.
 *
 * It used to be the first card on the dashboard, and it filled the opening screen: the
 * greeting, the range picker and six queue rows, with the first actual number below the
 * fold. Two things were true at once — deciding what is in this queue is the reason
 * somebody opens the page in the morning, and most mornings they open it to read the
 * numbers. A card cannot serve both. A button that carries the count serves both: the
 * count is the part that says whether to look, and the panel is there when it does.
 *
 * The rows arrive as children, rendered on the server by `ActionQueue`, so opening the
 * panel fetches nothing and the count is never out of step with what is inside it.
 */
export function ActionQueueDrawer({
  count,
  unowned,
  worst,
  children,
}: {
  /** Open findings — every one, not just the rows shown inside. */
  count: number;
  unowned: number;
  /** Severity of the worst one, so the button can say whether it is urgent. */
  worst: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const urgent = worst === 'critical' || worst === 'high';

  return (
    <>
      <Button variant="outline" size="action" onClick={() => setOpen(true)}>
        <ListChecks />
        Action queue
        {count > 0 ? (
          // The count rides on the button because it is the whole point of the button. A
          // plain label would make somebody open the panel to find out it was empty.
          <span
            className={
              urgent
                ? 'ml-0.5 rounded-full bg-destructive px-1.5 py-0.5 text-micro font-bold tnum text-white'
                : 'ml-0.5 rounded-full bg-secondary px-1.5 py-0.5 text-micro font-bold tnum text-muted-foreground'
            }
          >
            {count}
          </span>
        ) : null}
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Action queue"
        description={
          count === 0
            ? 'Nothing waiting on a decision.'
            : `${count} open${unowned > 0 ? `, ${unowned} with no owner` : ''}. Worst first, then longest waiting.`
        }
      >
        <div className="py-3">{children}</div>

        {/* Pinned under the rows rather than in the header: it is what you do after
            reading them, and the panel scrolls. */}
        {count > 0 ? (
          <div className="sticky bottom-0 border-t border-border bg-card py-3">
            <Button asChild className="w-full">
              <Link href="/ai" onClick={() => setOpen(false)}>
                Work the queue <ArrowRight className="size-3" />
              </Link>
            </Button>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
