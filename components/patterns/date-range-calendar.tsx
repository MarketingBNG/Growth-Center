'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A two-month range calendar for the header's date pill.
 *
 * Everything here works in UTC, because everything it feeds does. `rangeFor` builds its
 * windows with `setUTCHours` and `customRange` parses `?from=&to=` as `T00:00:00Z`, so a
 * calendar working in the viewer's local zone would hand back a day the queries then read
 * as a different one — a picker off by one for everyone west of UTC, which is the same bug
 * the range label itself had before it was fixed to print UTC.
 *
 * No date library: the arithmetic a month grid needs is a day count and a weekday index,
 * and Date does both in UTC without help.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Monday-first, matching the weekday chart, which starts weeks on Monday so the quiet
 *  weekend sits together at one end rather than split across both. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const DAY_MS = 86_400_000;

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const utcMidnight = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day));

/** Today, floored to a UTC day, so "today" means the same thing here as in the queries. */
function todayUtc() {
  const now = new Date();
  return utcMidnight(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Monday=0 through Sunday=6. getUTCDay puts Sunday at 0, which would open every month on
 *  the wrong column. */
const mondayIndex = (d: Date) => (d.getUTCDay() + 6) % 7;

/** The cells of one month: leading blanks to line the 1st up under its weekday, then the
 *  days. Trailing blanks are not needed — the grid simply ends. */
function monthCells(year: number, month: number): (Date | null)[] {
  const first = utcMidnight(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = Array.from({ length: mondayIndex(first) }, () => null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(utcMidnight(year, month, day));
  return cells;
}

export type PickedRange = { from: Date; to: Date };

export function DateRangeCalendar({
  initial,
  onApply,
  onClear,
  onDismiss,
  max = todayUtc(),
}: {
  initial: PickedRange | null;
  onApply: (range: PickedRange) => void;
  onClear: () => void;
  onDismiss: () => void;
  /** Nothing after today: every figure on these pages records something that already
   *  happened, so a future window can only ever be empty. */
  max?: Date;
}) {
  const [start, setStart] = useState<Date | null>(initial?.from ?? null);
  const [end, setEnd] = useState<Date | null>(initial?.to ?? null);
  /** The day under the cursor while a start is chosen but an end is not, so the range
   *  being considered is shaded before it is committed. */
  const [hover, setHover] = useState<Date | null>(null);

  // Opens with the anchor month on the RIGHT, so the left month is one the reader can
  // actually use. Anchored on the left instead, a picker opened on the 1st of the month
  // showed a left month with one selectable day in it and a right month entirely in the
  // future — every cell disabled bar one.
  //
  // The anchor is the end of the current range, which is where the reader was last
  // looking, rather than always today.
  const anchor = initial?.to ?? max;
  const [view, setView] = useState(() => {
    const left = utcMidnight(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1);
    return { year: left.getUTCFullYear(), month: left.getUTCMonth() };
  });

  const ref = useRef<HTMLDivElement>(null);

  // Dismissed by clicking away or pressing Escape, the two things anyone tries first.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onDismiss]);

  // The left month is the one being viewed, the right is the next. Shown together because
  // a range crossing a month boundary is the common case, and paging back and forth to
  // place two ends is how a one-month picker feels broken.
  const months = useMemo(() => {
    const rightDate = utcMidnight(view.year, view.month + 1, 1);
    return [
      { year: view.year, month: view.month },
      { year: rightDate.getUTCFullYear(), month: rightDate.getUTCMonth() },
    ];
  }, [view]);

  // The forward arrow stops at the max month rather than paging into empty ones.
  const canGoForward =
    utcMidnight(months[1].year, months[1].month, 1) <
    utcMidnight(max.getUTCFullYear(), max.getUTCMonth(), 1);

  const step = (delta: number) => {
    const d = utcMidnight(view.year, view.month + delta, 1);
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };

  function pick(day: Date) {
    // A click after a completed range begins a new one rather than extending the last.
    if (!start || (start && end)) {
      setStart(day);
      setEnd(null);
      return;
    }
    // Clicking before the start swaps the ends rather than refusing. Picking the end first
    // is an ordinary slip with an obvious intent, which is how customRange already treats
    // a reversed URL.
    if (day < start) {
      setEnd(start);
      setStart(day);
    } else {
      setEnd(day);
    }
  }

  const provisionalEnd = end ?? (start && hover && hover > start ? hover : null);
  const inRange = (d: Date) =>
    start !== null && provisionalEnd !== null && d > start && d < provisionalEnd;
  /** The day under the cursor reads as the end it would become, rather than picking up the
   *  ordinary grey hover and leaving the shaded band stopping short of it. */
  const isProvisionalEnd = (d: Date) =>
    end === null && provisionalEnd !== null && d.getTime() === provisionalEnd.getTime();

  const spanDays =
    start && end ? Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1 : null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose a date range"
      // Right-aligned, opening leftward. The pill lives in the page header's actions row,
      // which is pushed to the right edge, so a left-anchored popover ran off the screen and
      // took the second month with it.
      className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(92vw,600px)] rounded-2xl border border-border bg-card p-4 shadow-xl"
    >
      <div className="flex items-center justify-between pb-3">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold">
          {MONTHS[months[0].month]} {months[0].year}
          <span className="font-normal text-muted-foreground"> – </span>
          {MONTHS[months[1].month]} {months[1].year}
        </p>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* One column below 520px: two 7-column grids side by side would give each day a
          20px tap target. */}
      <div className="grid gap-4 [grid-template-columns:1fr] min-[520px]:[grid-template-columns:1fr_1fr]">
        {months.map(({ year, month }, i) => (
          <div
            key={`${year}-${month}`}
            className={
              i === 1
                ? // A rule between the months. Without it the two 7-column grids sit flush
                  // and read as one fourteen-column month.
                  'hidden min-[520px]:block min-[520px]:border-l min-[520px]:border-line-soft min-[520px]:pl-4'
                : undefined
            }
          >
            <div className="grid grid-cols-7 gap-y-1">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="pb-1 text-center text-[10.5px] font-medium text-muted-foreground"
                >
                  {w}
                </span>
              ))}
              {monthCells(year, month).map((day, idx) => {
                if (!day) return <span key={`blank-${idx}`} />;

                const disabled = day > max;
                const isStart = start !== null && day.getTime() === start.getTime();
                const isEnd = end !== null && day.getTime() === end.getTime();
                const between = inRange(day);
                const ghostEnd = isProvisionalEnd(day);

                return (
                  <button
                    key={day.getTime()}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(day)}
                    onMouseEnter={() => setHover(day)}
                    aria-label={isoDay(day)}
                    aria-pressed={isStart || isEnd}
                    className={cn(
                      // No colour transition. The shaded band follows the cursor, so a
                      // 150ms fade meant the whole range caught up to the pointer rather
                      // than tracking it — it read as lag, not polish.
                      'mx-auto grid size-8 place-items-center rounded-lg text-[12.5px] tabular-nums',
                      disabled && 'cursor-not-allowed text-muted-foreground/40',
                      !disabled &&
                        !isStart &&
                        !isEnd &&
                        !between &&
                        !ghostEnd &&
                        'hover:bg-secondary',
                      between && 'bg-range-fill font-medium text-foreground',
                      ghostEnd && 'bg-range-fill font-semibold text-foreground',
                      (isStart || isEnd) && 'bg-primary font-semibold text-on-primary',
                    )}
                  >
                    {day.getUTCDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <p className="mr-auto text-[12px] text-muted-foreground">
          {start && end
            ? `${isoDay(start)} – ${isoDay(end)} · ${spanDays} ${spanDays === 1 ? 'day' : 'days'}`
            : start
              ? `${isoDay(start)} · now choose an end date`
              : 'Choose a start date'}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Reset
        </button>
        <button
          type="button"
          // Disabled until both ends exist. Half a range is not a range, and completing it
          // with today would apply a window nobody chose — the same reason customRange
          // returns null for a single date.
          disabled={!start || !end}
          onClick={() => start && end && onApply({ from: start, to: end })}
          className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-on-primary transition-opacity disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
