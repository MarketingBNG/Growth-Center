'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS } from '@/lib/enums';
import { DateRangeCalendar, isoDay, type PickedRange } from './date-range-calendar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/**
 * Formatted in UTC, deliberately.
 *
 * `toLocaleDateString` without a fixed zone renders in the server's timezone during SSR
 * and the viewer's in the browser, which is a hydration mismatch on every page carrying
 * this control. UTC is also the window `rangeFor` actually queries — it builds the range
 * with `setUTCHours` — so this label now agrees with the numbers beside it rather than
 * being a day out for anyone west of UTC.
 */
function spanLabel(from: Date, to: Date) {
  // A window that crosses New Year has to carry both years. With one year printed at the
  // end, the 12-month range read "Sep 1 – Aug 31, 2026" — a range that runs backwards
  // inside a single year, rather than one starting in 2025.
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${fmt(from)} – ${fmt(to)}, ${to.getUTCFullYear()}`
    : `${fmt(from)}, ${from.getUTCFullYear()} – ${fmt(to)}, ${to.getUTCFullYear()}`;
}

function presetLabel(days: number) {
  const to = new Date();
  return spanLabel(new Date(to.getTime() - (days - 1) * 86_400_000), to);
}

/** `?from=&to=` as the calendar needs them. Parsed here rather than trusted: these come
 *  from the URL, and `customRange` on the server rejects the same shapes. */
function pickedFromUrl(params: URLSearchParams): PickedRange | null {
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** The date range lives in the URL, so a shared link shows the same numbers. */
/**
 * `current` is optional and read from the URL when it is not given.
 *
 * The page used to resolve it server-side and pass it down, which made the header depend
 * on searchParams — and under cacheComponents that is a dynamic read, so the whole header
 * had to sit behind a Suspense boundary and could not be part of the prerendered shell.
 * This component is already a client component holding the same query string, so it can
 * answer the question itself and let the header be static.
 */
export function RangePicker({ current }: { current?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const picked = pickedFromUrl(params);
  const active = current ?? params.get('range') ?? '30';

  const selected = RANGE_OPTIONS.find((o) => o.value === active) ?? RANGE_OPTIONS[0];
  const days = Number(String(selected.value).replace(/\D/g, '')) || 30;

  /** The page number belongs to the old range's row count. Narrowing from 365 days to 7
   *  while on page 40 landed on an empty table with a working pager above it, the same
   *  reason FilterBar drops it. */
  const go = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  };

  /** A preset and a hand-picked window are the same setting, so choosing one clears the
   *  other. Leaving `from`/`to` behind would have the URL say 7 days while the server,
   *  which prefers the explicit dates, went on answering for the old span. */
  const setPreset = (value: string) =>
    go((next) => {
      next.set('range', value);
      next.delete('from');
      next.delete('to');
    });

  const apply = (range: PickedRange) => {
    setOpen(false);
    go((next) => {
      next.set('from', isoDay(range.from));
      next.set('to', isoDay(range.to));
      next.delete('range');
    });
  };

  const clear = () => {
    setOpen(false);
    setPreset('30');
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      {/* Relative, so the calendar can hang off the pill it belongs to. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[10px] border bg-card px-3 text-[13px] font-medium transition-colors',
            // Outlined while a hand-picked window is in force: it is the one state where
            // none of the preset buttons is highlighted, so without this the whole control
            // looks like nothing is selected.
            picked ? 'border-primary text-primary' : 'border-border hover:bg-secondary',
          )}
        >
          <Calendar className={cn('size-[15px]', picked ? 'text-primary' : 'text-muted-foreground')} />
          {picked ? spanLabel(picked.from, picked.to) : presetLabel(days)}
        </button>

        {open ? (
          <DateRangeCalendar
            initial={picked}
            onApply={apply}
            onClear={clear}
            onDismiss={() => setOpen(false)}
          />
        ) : null}
      </div>

      <div className="inline-flex h-[38px] items-center rounded-[10px] border border-border bg-card p-0.5">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setPreset(o.value)}
            // Nothing is pressed while a hand-picked window is in force, which is what the
            // outlined pill beside these is saying.
            aria-pressed={!picked && active === o.value}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
              // The same blue the pill wears when a hand-picked window is in force. A grey
              // highlight here and a blue outline there said "this is your selection" in
              // two different colours for what is one setting.
              !picked && active === o.value
                ? 'bg-primary-soft font-semibold text-primary'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label.replace('Last ', '')}
          </button>
        ))}
      </div>
    </div>
  );
}
