import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { fmtCompact, fmtMoney, fmtPercent, fmtRatio } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Kpi } from '@/lib/metrics';
import { kpiDelta } from '@/lib/metrics';

function show(k: Kpi): string {
  if (k.value === null) return '—';
  switch (k.format) {
    case 'money':
      return fmtMoney(k.value);
    case 'percent':
      return fmtPercent(k.value);
    case 'ratio':
      return fmtRatio(k.value);
    default:
      return fmtCompact(k.value);
  }
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const change = kpiDelta(kpi);
  // Rising spend and rising CAC are not wins, so the colour follows the metric's own
  // direction rather than the arrow's.
  const good = change === null || change === 0 ? null : change > 0 === kpi.higherIsBetter;
  const Arrow = change === null || Math.abs(change) < 0.05 ? Minus : change > 0 ? ArrowUp : ArrowDown;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {kpi.label}
      </p>
      <p className="pt-1 text-2xl font-semibold tracking-tight tnum">{show(kpi)}</p>
      <div className="flex items-center gap-1 pt-0.5">
        {change === null ? (
          <span className="text-[11px] text-muted-foreground">
            {kpi.value === null ? (kpi.hint ?? 'No data') : 'No prior period'}
          </span>
        ) : (
          <>
            <Arrow
              className={cn(
                'size-3',
                good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive',
              )}
            />
            <span
              className={cn(
                'text-[11px] font-medium tnum',
                good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive',
              )}
            >
              {fmtPercent(Math.abs(change), 1)}
            </span>
            <span className="text-[11px] text-muted-foreground">vs prior period</span>
          </>
        )}
      </div>
    </div>
  );
}
