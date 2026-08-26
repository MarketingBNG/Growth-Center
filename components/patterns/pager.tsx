'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function Pager({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  function go(next: number) {
    const q = new URLSearchParams(params.toString());
    q.set('page', String(next));
    router.replace(`?${q.toString()}`);
  }

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-8 px-3 text-xs"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          Previous
        </Button>
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          className="h-8 px-3 text-xs"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
