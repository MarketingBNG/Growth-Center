'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/fetcher';

/**
 * Clears a finding someone has judged not worth acting on, and puts it back.
 *
 * Worth having only now that findings survive a regeneration. Before, the whole set was
 * deleted and rewritten on every run, so a dismissal expired the moment anyone pressed
 * Generate — which is why the column was filtered on for months and never written.
 *
 * A dismissal is not cleared when a later run raises the finding again: the point is that
 * someone has already decided about it. It comes back when the finding is resolved and
 * then genuinely recurs, or when it is restored here.
 */
export function DismissInsight({ id, dismissed, title }: { id: string; dismissed: boolean; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      try {
        await api(`/api/ai/insights/${id}`, { method: 'PATCH', json: { dismissed: !dismissed } });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        // Named in full for a screen reader, because the icon alone says "close" and this
        // does not close anything.
        aria-label={dismissed ? `Restore: ${title}` : `Dismiss: ${title}`}
        title={dismissed ? 'Restore this finding' : 'Dismiss this finding'}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {dismissed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </button>
      {error ? <p className="basis-full text-[11px] text-destructive">{error}</p> : null}
    </>
  );
}
