'use client';

import { fmtCompact, fmtNumber, fmtPercent } from '@/lib/format';
import { ChartFrame } from './chart-parts';

export type Stage = { key: string; label: string; value: number; hint?: string };

/**
 * Hand-drawn rather than a chart library's funnel: the numbers that matter here are
 * the step-to-step conversion rates, and those want to sit between the bars as direct
 * labels rather than in a tooltip.
 *
 * Bar widths are proportional to the FIRST stage, so the shape shows real drop-off.
 * A funnel scaled per-stage looks healthy no matter how bad the conversion is.
 */
export function FunnelChart({ stages, title = 'Growth funnel', subtitle }: { stages: Stage[]; title?: string; subtitle?: string }) {
  const top = stages[0]?.value ?? 0;

  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <ol className="space-y-1 px-3 py-2">
        {stages.map((s, i) => {
          const previous = i > 0 ? stages[i - 1].value : null;
          const step = previous ? (previous === 0 ? null : (s.value / previous) * 100) : null;
          // A floor of 1.5% keeps a tiny final stage visible as a bar rather than a line.
          const width = top > 0 ? Math.max((s.value / top) * 100, 1.5) : 0;

          return (
            <li key={s.key}>
              {step !== null ? (
                <p className="py-0.5 pl-1 text-[11px] text-muted-foreground tnum">
                  ↓ {fmtPercent(step, step < 10 ? 2 : 1)}
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div
                    className="flex h-9 items-center rounded-r-[4px] bg-chart-1/25 ring-1 ring-inset ring-chart-1/40"
                    style={{ width: `${width}%` }}
                  >
                    <span className="truncate px-2.5 text-xs font-medium">{s.label}</span>
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right text-sm font-semibold tnum">
                  {s.value >= 100000 ? fmtCompact(s.value) : fmtNumber(s.value)}
                </span>
              </div>
              {s.hint ? <p className="pl-1 pt-0.5 text-[11px] text-muted-foreground">{s.hint}</p> : null}
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
