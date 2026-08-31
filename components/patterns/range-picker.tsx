'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS } from '@/lib/enums';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formatted in UTC, deliberately.
 *
 * `toLocaleDateString` without a fixed zone renders in the server's timezone during SSR
 * and the viewer's in the browser, which is a hydration mismatch on every page carrying
 * this control. UTC is also the window `rangeFor` actually queries — it builds the range
 * with `setUTCHours` — so this label now agrees with the numbers beside it rather than
 * being a day out for anyone west of UTC.
 */
function label(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${fmt(from)} – ${fmt(to)}, ${to.getUTCFullYear()}`;
}

/** The date range lives in the URL, so a shared link shows the same numbers. */
export function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', value);
    // The page number belongs to the old range's row count. Narrowing from 365 days to 7
    // while on page 40 landed on an empty table with a working pager above it, the same
    // reason FilterBar drops it.
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  const selected = RANGE_OPTIONS.find((o) => o.value === current) ?? RANGE_OPTIONS[0];
  const days = Number(String(selected.value).replace(/\D/g, '')) || 30;

  return (
    <div className="flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      {/* The resolved dates, so the range is never ambiguous. Display only. */}
      <span className="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[10px] border border-border bg-card px-3 text-[13px] font-medium">
        <Calendar className="size-[15px] text-muted-foreground" />
        {label(days)}
      </span>

      <div className="inline-flex h-[38px] items-center rounded-[10px] border border-border bg-card p-0.5">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => set(o.value)}
            aria-pressed={current === o.value}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
              current === o.value
                ? 'bg-secondary font-semibold text-foreground'
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
