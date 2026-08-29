'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Week' },
  { value: '30', label: 'Month' },
] as const;

/** UTC, matching the window the queries actually run — a local-time label would be a day
 *  out for anyone west of UTC and would not agree with the numbers beside it. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Today / Week / Month, plus a calendar for anything else.
 *
 * The range lives in the URL — `?range=` for a preset, `?from=&to=` for a custom window —
 * so a shared link shows the same figures, and the back button works.
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
  const [start, setStart] = useState(from ?? today());
  const [end, setEnd] = useState(to ?? today());

  const custom = Boolean(from && to);

  function preset(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', value);
    // A preset and a custom window are the same setting; leaving the old dates behind
    // would let them win and the buttons would appear to do nothing.
    next.delete('from');
    next.delete('to');
    setOpen(false);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  function apply() {
    const next = new URLSearchParams(params.toString());
    next.set('from', start);
    next.set('to', end);
    next.delete('range');
    setOpen(false);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

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
              !custom && range === p.value
                ? 'bg-secondary font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:text-foreground',
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
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
            custom
              ? 'bg-secondary font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          <Calendar className="size-[15px]" />
          {label}
        </button>
      </div>

      {open ? (
        <div className="absolute right-0 top-[42px] z-20 w-[260px] rounded-[10px] border border-border bg-card p-3 shadow-lg">
          <label className="block text-[11px] font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="mb-2 mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-[13px]"
          />
          <label className="block text-[11px] font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className="mb-3 mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-[13px]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-md bg-primary px-2.5 py-1.5 text-[13px] font-semibold text-primary-foreground"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
