'use client';

import { useEffect } from 'react';

/**
 * Closes a popover on an outside click or Escape — the two things anyone tries first.
 *
 * Written out three times: the account menu in the sidebar, the notifications panel, and
 * the date-range calendar. The listeners and their paired removal were identical every
 * time; what differed was only how each one decided whether a click had landed inside it,
 * so that is the argument.
 *
 * `active` keeps the listeners off the document while the thing is closed — an idle
 * sidebar should not be watching every mousedown in the app. The calendar mounts only
 * while open and passes nothing, which is the same statement made structurally.
 */
export function useDismiss({
  active = true,
  contains,
  onDismiss,
}: {
  active?: boolean;
  /** Whether the event landed inside the thing being dismissed. */
  contains: (target: Node) => boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!active) return;

    const away = (e: MouseEvent) => {
      if (!contains(e.target as Node)) onDismiss();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };

    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
    // `contains` is rebuilt every render by every caller; depending on it would rebind the
    // listeners on each one. What actually decides whether they should be bound is
    // `active`, and the predicate only ever reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onDismiss]);
}
