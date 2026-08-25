'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS } from '@/lib/enums';

/** The date range lives in the URL, so a shared link shows the same numbers. */
export function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', value);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div
      className="inline-flex items-center rounded-md border border-border p-0.5"
      data-pending={pending || undefined}
    >
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => set(o.value)}
          aria-pressed={current === o.value}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            current === o.value
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label.replace('Last ', '')}
        </button>
      ))}
    </div>
  );
}
