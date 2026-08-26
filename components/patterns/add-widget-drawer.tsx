'use client';

import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

type Preview = 'donut' | 'bars' | 'grid' | 'line';

type Widget = {
  title: string;
  body: string;
  tag: string;
  preview: Preview;
};

const WIDGETS: Widget[] = [
  {
    title: 'Visitors by source',
    body: 'Where traffic comes from, split across paid, organic and referral.',
    tag: 'Acquisition',
    preview: 'donut',
  },
  {
    title: 'Pipeline velocity',
    body: 'How long a deal spends in each stage, and where they stall.',
    tag: 'Pipeline',
    preview: 'bars',
  },
  {
    title: 'Cohort retention',
    body: 'Revenue retained by the month a customer signed.',
    tag: 'Revenue',
    preview: 'grid',
  },
  {
    title: 'Lead response time',
    body: 'Median time from a hand-raise to first contact, by owner.',
    tag: 'Operations',
    preview: 'line',
  },
  {
    title: 'Campaign attribution',
    body: 'Revenue credited to each campaign along the full funnel.',
    tag: 'Marketing',
    preview: 'bars',
  },
];

/** A sketch of the widget's shape, not a chart. Deliberately abstract: a real-looking
 *  chart full of invented numbers would read as data the user already has. */
function Sketch({ kind }: { kind: Preview }) {
  const stroke = 'var(--chart-1)';
  switch (kind) {
    case 'donut':
      return (
        <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
          <circle cx="30" cy="30" r="20" fill="none" stroke="var(--track)" strokeWidth="9" />
          <circle
            cx="30"
            cy="30"
            r="20"
            fill="none"
            stroke={stroke}
            strokeWidth="9"
            strokeDasharray="78 126"
            transform="rotate(-90 30 30)"
          />
        </svg>
      );
    case 'bars':
      return (
        <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
          {[
            [8, 26],
            [20, 14],
            [32, 34],
            [44, 22],
          ].map(([x, h], i) => (
            <rect
              key={x}
              x={x}
              y={48 - h}
              width="9"
              height={h}
              rx="2.5"
              fill={i === 2 ? stroke : 'var(--track)'}
            />
          ))}
        </svg>
      );
    case 'grid':
      return (
        <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={8 + c * 12}
                y={8 + r * 12}
                width="9"
                height="9"
                rx="2"
                fill={stroke}
                opacity={0.15 + ((3 - r) * 0.22 + c * 0.05)}
              />
            )),
          )}
        </svg>
      );
    case 'line':
      return (
        <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
          <polyline
            points="8,40 18,30 26,34 36,18 46,24 52,14"
            fill="none"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

/**
 * The "Add widget" drawer.
 *
 * Placement is not implemented — there is no widget persistence to write to yet — so
 * Select acknowledges the choice and says so rather than pretending a card was added.
 */
export function AddWidgetDrawer() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <>
      <Button variant="outline" size="action" onClick={() => setOpen(true)}>
        <LayoutGrid /> Add widget
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add widget"
        description="Drag a card onto the dashboard, or select it."
      >
        <ul>
          {WIDGETS.map((w) => (
            <li
              key={w.title}
              draggable
              className="flex cursor-grab items-start gap-4 border-b border-border py-[18px] last:border-0"
            >
              <div className="grid h-24 w-[118px] shrink-0 place-items-center rounded-[14px] border border-border bg-surface-sunken">
                <Sketch kind={w.preview} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{w.title}</p>
                <p className="pt-0.5 text-[12px] leading-[1.55] text-muted-foreground">{w.body}</p>
                <div className="flex flex-wrap items-center gap-2 pt-2.5">
                  <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold">
                    #{w.tag}
                  </span>
                  <Button
                    className="h-[30px] rounded-full px-3 text-xs font-bold"
                    onClick={() => setPicked(w.title)}
                  >
                    Select
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="py-4 text-[11.5px] text-muted-foreground" role="status">
          {picked
            ? `"${picked}" is selected. Placing widgets on the dashboard is not built yet, so nothing has been added.`
            : 'Placing widgets on the dashboard is not built yet.'}
        </p>
      </Sheet>
    </>
  );
}
