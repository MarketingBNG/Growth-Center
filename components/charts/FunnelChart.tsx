'use client';

import { fmtCompact, fmtNumber, fmtPercent } from '@/lib/format';
import { ChartFrame } from './chart-parts';

export type Stage = { key: string; label: string; value: number; hint?: string };

/** Stage order, never cycled — the fill identifies the step, not a category. */
const STAGE_FILL = [
  'var(--chart-1)',
  'var(--chart-6)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-2)',
] as const;

/**
 * Hand-drawn rather than a chart library's funnel: the numbers that matter here are the
 * step-to-step conversion rates, and those want to sit as direct labels rather than in a
 * tooltip.
 *
 * Bar widths are proportional to the FIRST stage, so the shape shows real drop-off — a
 * funnel scaled per-stage looks healthy no matter how bad the conversion is.
 *
 * The rate reads against the stage immediately above, not against the top of the funnel:
 * "37.9% of leads" is actionable where "1.0% of visitors" is not.
 */
export function FunnelChart({
  stages,
  title = 'Growth funnel',
  subtitle,
}: {
  stages: Stage[];
  title?: string;
  subtitle?: string;
}) {
  const top = stages[0]?.value ?? 0;

  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <ol className="flex flex-col gap-[11px] px-3 pb-2 pt-2">
        {stages.map((s, i) => {
          const previous = i > 0 ? stages[i - 1] : null;
          const step = previous && previous.value > 0 ? (s.value / previous.value) * 100 : null;
          // A floor keeps a tiny final stage visible as a sliver rather than nothing.
          const width = top > 0 ? Math.max((s.value / top) * 100, 2) : 0;

          return (
            <li key={s.key}>
              <div className="flex items-baseline gap-3 pb-1.5">
                <span className="min-w-0 truncate text-[12.5px] font-semibold" title={s.label}>
                  {s.label}
                </span>
                <span className="ml-auto shrink-0 text-[13.5px] font-bold tnum">
                  {s.value >= 100000 ? fmtCompact(s.value) : fmtNumber(s.value)}
                </span>
                {step !== null ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground tnum">
                    {fmtPercent(step, step < 10 ? 2 : 1)} of {previous!.label.toLowerCase()}
                  </span>
                ) : null}
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, background: STAGE_FILL[i % STAGE_FILL.length] }}
                />
              </div>

              {s.hint ? (
                <p className="pt-1 text-[11px] text-muted-foreground">{s.hint}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
