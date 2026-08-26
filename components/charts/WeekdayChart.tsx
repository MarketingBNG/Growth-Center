'use client';

import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type WeekdayPoint = { label: string; value: number };

/**
 * Seven bars, one per weekday. Hand-drawn rather than a chart library: at seven fixed
 * categories a library buys nothing, and the peak-vs-rest emphasis wants direct control
 * over each bar's fill.
 *
 * The peak bar carries the accent and the rest sit in --track. --track is deliberately
 * not --background, or the bars would vanish on a sunken surface.
 */
export function WeekdayChart({
  data,
  caption,
  className,
}: {
  data: WeekdayPoint[];
  /** Overrides the generated "214 leads on Tuesday" line. */
  caption?: string;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const peak = max > 0 ? data.reduce((a, b) => (b.value > a.value ? b : a), data[0]) : null;

  const headline =
    caption ??
    (peak && max > 0
      ? `${fmtNumber(peak.value)} leads on ${peak.label}`
      : 'No leads in this period');

  return (
    <div className={cn('flex flex-col', className)}>
      <p className="pb-3 text-xs font-bold text-muted-foreground">{headline}</p>

      <div className="flex h-[118px] items-end gap-2">
        {data.map((d) => {
          const isPeak = peak !== null && d.label === peak.label && d.value === peak.value;
          // A floor keeps a zero day visible as a sliver, so the axis reads as seven
          // days rather than as four.
          const height = max > 0 ? Math.max((d.value / max) * 96, 3) : 3;
          return (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className={cn('w-full rounded-lg', isPeak ? 'bg-chart-1' : 'bg-track')}
                style={{ height }}
                title={`${d.label}: ${fmtNumber(d.value)}`}
              />
              <span
                className={cn(
                  'text-[11px]',
                  isPeak ? 'font-bold text-chart-1' : 'font-medium text-muted-foreground',
                )}
              >
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
