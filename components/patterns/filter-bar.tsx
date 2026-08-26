'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export type FilterDef = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
};

/**
 * Filters live in the URL, not in component state: a filtered view is shareable, the
 * back button works, and the server component re-reads searchParams on its own.
 */
export function FilterBar({
  filters,
  searchPlaceholder = 'Search…',
}: {
  filters: FilterDef[];
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  const active = filters.some((f) => params.get(f.name)) || params.get('q');

  return (
    <div className="flex flex-wrap items-center gap-2 pb-4" data-pending={pending || undefined}>
      <div className="relative min-w-52 flex-1 sm:max-w-[220px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          defaultValue={params.get('q') ?? ''}
          placeholder={searchPlaceholder}
          className="pl-9"
          onKeyDown={(e) => {
            if (e.key === 'Enter') update('q', (e.target as HTMLInputElement).value.trim());
          }}
        />
      </div>

      {filters.map((f) => (
        <Select
          key={f.name}
          aria-label={f.label}
          className="w-auto min-w-32"
          value={params.get(f.name) ?? ''}
          onChange={(e) => update(f.name, e.target.value)}
        >
          <option value="">{f.label}: all</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}

      {active ? (
        <Button variant="ghost" size="sm" onClick={() => startTransition(() => router.replace('?'))}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
