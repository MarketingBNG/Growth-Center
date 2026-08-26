'use client';

import { fmtPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const TICKS = 44;
const INNER = 62;
const OUTER = 78;
const CENTER = { x: 100, y: 88 };

/**
 * A semicircular tick gauge for a single rate.
 *
 * Ticks rather than a solid arc: a discrete scale is read as "roughly 7 in 10" at a
 * glance, where a smooth arc invites false precision on a number that is itself an
 * estimate.
 *
 * `value` is a percentage, or null when there is no denominator — in which case the
 * gauge renders empty with an em dash rather than a confident 0%.
 */
export function GaugeChart({
  value,
  note,
  target,
  action,
  className,
}: {
  value: number | null;
  note?: string;
  /** Drawn as the reference the note describes; does not change the fill. */
  target?: number | null;
  action?: React.ReactNode;
  className?: string;
}) {
  const pct = value === null ? 0 : Math.min(Math.max(value, 0), 100);
  const filled = Math.round((pct / 100) * TICKS);

  // Rounded, deliberately. Math.cos/Math.sin are implementation-dependent in
  // ECMAScript, so Node and the browser can disagree in the last bits — enough to make
  // every tick's coordinates a hydration mismatch. Three decimals is far below
  // sub-pixel in a 200-unit viewBox and is identical everywhere.
  const round = (n: number) => Math.round(n * 1000) / 1000;

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    // 180° sweep, left to right.
    const angle = Math.PI - (i / (TICKS - 1)) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const on = i < filled;
    return {
      i,
      on,
      x1: round(CENTER.x + cos * INNER),
      y1: round(CENTER.y - sin * INNER),
      x2: round(CENTER.x + cos * OUTER),
      y2: round(CENTER.y - sin * OUTER),
      // Ramp the filled arc so the leading edge is the strongest mark on it.
      opacity: on ? round(0.45 + (i / Math.max(filled - 1, 1)) * 0.55) : 1,
    };
  });

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative w-full max-w-[200px]">
        <svg
          viewBox="0 0 200 96"
          className="w-full"
          role="img"
          aria-label={
            value === null
              ? 'No data for this rate'
              : `${fmtPercent(value)}${target ? ` against a ${target}% target` : ''}`
          }
        >
          {ticks.map((t) => (
            <line
              key={t.i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              strokeWidth={3.4}
              strokeLinecap="round"
              stroke={t.on ? 'var(--chart-3)' : 'var(--track)'}
              opacity={t.opacity}
            />
          ))}
        </svg>

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tnum">
            {value === null ? '—' : fmtPercent(value)}
          </span>
        </div>
      </div>

      {note ? (
        <p className="pt-2 text-center text-[11px] text-muted-foreground">{note}</p>
      ) : null}
      {action ? <div className="pt-2.5">{action}</div> : null}
    </div>
  );
}
