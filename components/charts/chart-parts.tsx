'use client';

import { cn } from '@/lib/utils';

// Shared chart furniture. Grid and axes are recessive; every label wears a text token
// rather than a series colour, so identity is carried by the mark beside it.

export const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 10.5,
  tickLine: false,
  axisLine: false,
} as const;

export const GRID = { stroke: 'var(--grid)', strokeDasharray: '3 4' } as const;

/** Six slots, assigned in order. TrendChart wraps with `i % SERIES.length`, so a 7th
 *  series would repeat the first colour — every call site currently passes one series,
 *  and any chart that grows past six needs an "Other" bucket before it is added. */
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
  legend?: { label: string; color: string; dashed?: boolean }[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('rounded-2xl border border-border bg-card shadow-card', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-[18px]">
        <figcaption>
          <h3 className="text-[14.5px] font-bold leading-tight tracking-tight">{title}</h3>
          {subtitle ? <p className="text-[11.5px] text-muted-foreground">{subtitle}</p> : null}
        </figcaption>
        {/* A legend is always present for two or more series, so identity is never
            colour-alone. One series needs none — the title names it. */}
        {legend && legend.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-3.5">
            {legend.map((l) => (
              <li
                key={l.label}
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"
              >
                {/* Mirrors the mark on the plot: a solid swatch for the filled series,
                    a split one for the dashed. Colour is never the only cue. */}
                <span
                  aria-hidden
                  className="h-[9px] w-[9px] shrink-0 rounded-[3px]"
                  style={
                    l.dashed
                      ? { background: `repeating-linear-gradient(90deg, ${l.color} 0 3px, transparent 3px 4.5px)` }
                      : { background: l.color }
                  }
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
    <div className="pointer-events-none w-[156px] rounded-xl border border-border bg-card px-3 py-2.5 shadow-card">
      <p className="pb-1.5 text-[11.5px] font-bold">{label}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-[11.5px]">
            <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: r.color }} />
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto font-bold text-foreground tnum">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
