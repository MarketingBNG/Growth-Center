'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A write that the server render has to catch up with.
 *
 * The sibling of [[use-api-action]], for the other half of the client components. Where
 * that one tracks a busy flag around a fetch, these save a setting and then need the page
 * behind them re-read — so the work goes inside a transition and ends in router.refresh(),
 * and `pending` comes from React rather than from a useState nobody can forget to clear.
 *
 * Six components wrote this out by hand, down to the same fallback sentence for an error
 * that is not an Error. Five of them spelled it "Could not save." and the sixth reached
 * the same line by a different route.
 *
 * `onError` is for the optimistic ones. Three of these paint the new value into a field
 * the instant it is chosen and have to paint the old one back if the write is refused;
 * that revert is theirs, not this hook's, so it is handed back rather than absorbed. It
 * runs before the message is set, so the field is already correct by the time anyone
 * reads why.
 */
export function useMutation() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<void>, onError?: (e: unknown) => void) {
    setError(null);
    start(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        onError?.(e);
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return { pending, error, setError, run };
}
