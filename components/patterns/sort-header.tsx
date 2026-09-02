'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TH_CLASS } from '@/components/ui/table';

/**
 * A column header that sorts the list it heads.
 *
 * `?sort=` and `?dir=` were already validated by `listQuery` and applied by every list
 * query, against a per-model allow-list — but no header was clickable, so the only way to
 * reach any of it was to hand-editing the URL. This is the missing affordance, not a new
 * feature.
 *
 * Renders its own `<th>` rather than sitting inside one: `aria-sort` is only meaningful on
 * the cell, and a button cannot carry it.
 *
 * `name` must be a column the page's own allow-list permits; anything else is ignored
 * server-side and the list falls back to its default order.
 */
export function SortHeader({
  name,
  children,
  className,
  align = 'left',
}: {
  name: string;
  children: React.ReactNode;
  className?: string;
  /** Right-aligned for numeric and date columns, so the control sits under the values. */
  align?: 'left' | 'right';
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const active = params.get('sort') === name;
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';

  // First click on a new column sorts descending — the useful default for dates and
  // counts. Clicking the active column flips it.
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc';

  function go() {
    const next = new URLSearchParams(params.toString());
    next.set('sort', name);
    next.set('dir', nextDir);
    // The old page number belongs to the old ordering.
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      className={cn(TH_CLASS, align === 'right' && 'text-right', className)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={go}
        data-pending={pending || undefined}
        className={cn(
          'group inline-flex items-center gap-1 uppercase tracking-[inherit] transition-colors hover:text-foreground',
          active && 'text-foreground',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {children}
        <Icon
          className={cn(
            'size-3 shrink-0 transition-opacity',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
          )}
        />
      </button>
    </th>
  );
}
