'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function Pager({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The page number the buttons work from is the optimistic one, not the server prop.
  // Reading the prop meant a second click before the first navigation landed computed
  // `page + 1` from the same stale value, so clicking Next twice in quick succession
  // advanced a single page and the second click was silently lost.
  const [shown, showPage] = useOptimistic(page);
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  function go(next: number) {
    startTransition(() => {
      showPage(next);
      const q = new URLSearchParams(params.toString());
      q.set('page', String(next));
      router.replace(`?${q.toString()}`);
    });
  }

  const from = (shown - 1) * perPage + 1;
  const to = Math.min(shown * perPage, total);

  return (
    <div
      className="flex items-center justify-between gap-3 border-t border-border px-5 py-3"
      data-pending={pending || undefined}
    >
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-8 px-3 text-xs"
          disabled={shown <= 1}
          onClick={() => go(shown - 1)}
        >
          Previous
        </Button>
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {shown} / {pages}
        </span>
        <Button
          variant="outline"
          className="h-8 px-3 text-xs"
          disabled={shown >= pages}
          onClick={() => go(shown + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
