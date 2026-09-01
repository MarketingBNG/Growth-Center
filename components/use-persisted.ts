'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Client-only state that survives a reload, without setting state from an effect.
 *
 * The obvious way to write this — render the fallback, then read localStorage in an
 * effect and setState — is what the sidebar, the metrics band and the theme toggle all
 * did. It works, but it renders twice on every mount and React's set-state-in-effect rule
 * flags it, correctly: the second render is not caused by anything the user did.
 *
 * useSyncExternalStore is the shape React provides for exactly this. The server snapshot
 * is the fallback, so the markup it produces still matches what the client renders first
 * and there is no hydration mismatch; the client snapshot reads the stored value, so the
 * value is right from the first client render rather than one render later.
 */

/** Subscribers per key, so a write in one component reaches every other reader of the
 *  same key — two sidebars, or a band and the toggle that collapsed it. */
const listeners = new Map<string, Set<() => void>>();

/** Snapshots must be referentially stable between reads or useSyncExternalStore loops
 *  forever: it compares the returned value by identity to decide whether to re-render,
 *  and JSON.parse hands back a new object every time. Parsed values are cached against
 *  the exact string they came from, and the cache is dropped when the string changes. */
const parsed = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // A blocked or full localStorage is not worth breaking the shell over.
    return fallback;
  }

  const cached = parsed.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // A value written by an older version, or by hand, falls back rather than throwing
      // inside a render.
      value = fallback;
    }
  }
  parsed.set(key, { raw, value });
  return value;
}

function notify(key: string) {
  for (const l of listeners.get(key) ?? []) l();
}

export function usePersisted<T>(key: string, fallback: T) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(onChange);
      // Another tab writing the same key counts as a change here too.
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) {
          parsed.delete(key);
          onChange();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        set.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    // The server has no localStorage, so it renders the fallback — which is what the
    // client's first paint has to match.
    () => fallback,
  );

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(read(key, fallback)) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* ignore — the value still updates in memory below */
      }
      parsed.set(key, { raw: JSON.stringify(resolved), value: resolved });
      notify(key);
    },
    [key, fallback],
  );

  return useMemo(() => [value, set] as const, [value, set]);
}

/**
 * False on the server and on the first client render, true afterwards.
 *
 * For markup that genuinely cannot be produced on the server — a theme icon, a
 * locale-formatted date — where the answer is not stored anywhere to read.
 */
const emptySubscribe = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
