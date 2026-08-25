'use client';

import { cn } from '@/lib/utils';

// Shared chart furniture. Grid and axes are recessive; every label wears a text token
// rather than a series colour, so identity is carried by the mark beside it.

export const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export const GRID = { stroke: 'var(--grid)', strokeDasharray: '0' } as const;

/** Assign in order, never cycle. A 9th series folds into "Other". */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-1">
        <figcaption>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </figcaption>
        {/* A legend is always present for two or more series, so identity is never
            colour-alone. One series needs none — the title names it. */}
        {legend && legend.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-3">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: l.color }}
                />
                {l.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="px-2 pb-3">{children}</div>
    </figure>
  );
}

export function Tip({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; label: string; value: string; color: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-xl">
      <p className="pb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto font-medium tnum">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
