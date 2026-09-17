'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Changing the query string, which is how every list screen holds its state.
 *
 * Seven copies across five files: read the current params, copy them, mutate the copy,
 * replace the URL inside a transition. RangePicker had already named the shape as a local
 * `go(mutate)`; this is that, shared.
 *
 * Copied rather than mutated in place because `useSearchParams()` returns a read-only
 * object, and `replace` rather than `push` because a filter change is not a place you
 * should have to press Back through.
 *
 * What stays with the caller: which keys to set, and whether to drop `page`. Most do —
 * changing a filter or a sort while on page 40 lands on an empty table with a working
 * pager above it — but the pager itself is setting that number, so the decision cannot
 * live here.
 */
export function useSearchParamUpdate() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /**
   * `scroll` defaults to false: these replace the current screen's own state, and jumping
   * to the top after ticking a filter loses the row you were reading.
   */
  function update(mutate: (next: URLSearchParams) => void, opts?: { scroll?: boolean }) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const query = next.toString();
    startTransition(() =>
      router.replace(query ? `?${query}` : '?', { scroll: opts?.scroll ?? false }),
    );
  }

  return { params, pending, update };
}
