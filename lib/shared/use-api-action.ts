'use client';

import { useState } from 'react';

/**
 * The busy/error state around a mutation, that most client components in app/(app) built
 * by hand around lib/shared/fetcher's api(): set busy, clear the last error, run the call, catch
 * a failure into the error state, always clear busy. One copy here rather than thirty —
 * see the components that use it for what still varies (the request itself, and what
 * happens on success).
 *
 * `Busy` defaults to a boolean for the common "is anything happening" case. A few
 * components track WHICH of several concurrent actions is running — `useApiAction<string
 * | null>(null)` and `run('connect', ...)` — so it is generic over that rather than
 * assuming one shape.
 */
export function useApiAction<Busy = boolean>(idle: Busy) {
  const [busy, setBusy] = useState<Busy>(idle);
  const [error, setError] = useState<string | null>(null);

  async function run(busyValue: Busy, action: () => Promise<void>) {
    setBusy(busyValue);
    setError(null);
    try {
      await action();
    } catch (e) {
      // Not `(e as Error).message`: a thrown non-Error has no `message`, so that set the
      // error to undefined and ErrorText rendered nothing — a failed write that looked
      // like a successful one. Same fallback sentence as [[use-mutation]], which is the
      // other half of these components and already said it.
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(idle);
    }
  }

  // Exposed for the rare action that must not reset busy on success — a redirect away
  // from the page, say, where the button should stay disabled through the navigation
  // rather than flash re-enabled for the instant before the browser actually leaves.
  return { busy, error, run, setBusy, setError };
}

/** The common case: run(action) with busy as a plain boolean. */
export function useBooleanApiAction() {
  const { busy, error, run, setBusy, setError } = useApiAction(false);
  return { busy, error, setBusy, setError, run: (action: () => Promise<void>) => run(true, action) };
}
