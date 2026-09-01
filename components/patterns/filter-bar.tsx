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
  /** What the empty option says. Defaults to "<label>: all" — which is a lie wherever the
   *  page narrows the list before the filter is touched, as Tasks does by hiding finished
   *  work. Naming the real default stops "Status: all" sitting over a filtered table. */
  allLabel?: string;
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

  // Clear drops the filters and the search term — and nothing else. It used to replace the
  // whole query string, which also threw away the date range and, on the CRM screen, the
  // tab: clearing a search while reading Contacts bounced you back to Companies.
  function clear() {
    const next = new URLSearchParams(params.toString());
    next.delete('q');
    next.delete('page');
    for (const f of filters) next.delete(f.name);
    const query = next.toString();
    startTransition(() => router.replace(query ? `?${query}` : '?'));
  }

  const active = filters.some((f) => params.get(f.name)) || params.get('q');

  return (
    <div className="flex flex-wrap items-center gap-2 pb-4" data-pending={pending || undefined}>
      <div className="relative min-w-52 flex-1 sm:max-w-[220px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          // Keyed on the term in the URL so Clear — or any navigation that drops `q` —
          // remounts the field. Uncontrolled, it kept showing the old text over results
          // that were no longer filtered by it.
          key={params.get('q') ?? ''}
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
          <option value="">{f.allLabel ?? `${f.label}: all`}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}

      {active ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
