'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRangeCalendar, isoDay, type PickedRange } from './date-range-calendar';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Week' },
  { value: '30', label: 'Month' },
] as const;

/**
 * Today / Week / Month, plus a calendar for anything else.
 *
 * The range lives in the URL — `?range=` for a preset, `?from=&to=` for a custom window —
 * so a shared link shows the same figures, and the back button works.
 *
 * Distinct from RangePicker, which offers 7/30/90/365 on the reporting pages. CRM asks a
 * different question of its window — how the day or the week is going — so the presets
 * differ. What no longer differs is the calendar behind the date button and the way a
 * selection is marked: both come from the same place as the other seven pages.
 */
export function DateRangePicker({
  range,
  from,
  to,
  label,
}: {
  range: string;
  from?: string;
  to?: string;
  /** The resolved window, rendered as-is so the control cannot disagree with the page. */
  label: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const custom = Boolean(from && to);

  /** Parsed rather than trusted: these come from the URL, and `customRange` on the server
   *  rejects the same shapes. */
  const picked: PickedRange | null = (() => {
    if (!from || !to) return null;
    const a = new Date(`${from}T00:00:00Z`);
    const b = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  })();

  function preset(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', value);
    // A preset and a custom window are the same setting; leaving the old dates behind
    // would let them win and the buttons would appear to do nothing.
    next.delete('from');
    next.delete('to');
    next.delete('page');
    setOpen(false);
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  function apply(next: PickedRange) {
    const q = new URLSearchParams(params.toString());
    q.set('from', isoDay(next.from));
    q.set('to', isoDay(next.to));
    q.delete('range');
    // The page number belongs to the old window's row count, the same reason the presets
    // drop it.
    q.delete('page');
    setOpen(false);
    startTransition(() => router.replace(`?${q.toString()}`, { scroll: false }));
  }

  /** The blue the whole app now uses for "this is your selection". */
  const chosen = 'bg-primary-soft font-semibold text-primary';
  const unchosen = 'font-medium text-muted-foreground hover:text-foreground';

  return (
    <div className="relative flex items-center gap-2" data-pending={pending || undefined}>
      <div className="inline-flex h-[38px] items-center rounded-[10px] border border-border bg-card p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => preset(p.value)}
            aria-pressed={!custom && range === p.value}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
              !custom && range === p.value ? chosen : unchosen,
            )}
          >
            {p.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-pressed={custom}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
            custom ? chosen : unchosen,
          )}
        >
          <Calendar className="size-[15px]" />
          {label}
        </button>
      </div>

      {/* The same calendar the other seven pages open. This used to be two native date
          inputs, which is a different thing to learn on one page for no reason — and
          `<input type="date">` renders as whatever the browser feels like, so it did not
          follow the theme either. */}
      {open ? (
        <DateRangeCalendar
          initial={picked}
          onApply={apply}
          onClear={() => preset('30')}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
