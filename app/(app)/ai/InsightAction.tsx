'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { STATUS_LABELS, nextStatuses, type InsightStatus } from '@/lib/insight-lifecycle';

/**
 * Moving one finding along, with whatever that move requires.
 *
 * The owner field appears for an assignment and the reason field for a dismissal, because
 * those are the two moves that are refused without them — §20.1 rules out both the action
 * with nobody carrying it and the commentary nobody ruled on. Showing the field only when
 * it is needed keeps the row quiet in the common case; the server refuses either way, so
 * the form is a convenience and not the guard.
 */
export function InsightAction({
  id,
  status,
  owners,
  currentOwner,
}: {
  id: string;
  status: InsightStatus;
  owners: { email: string; name: string | null }[];
  currentOwner: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<InsightStatus | null>(null);
  const [owner, setOwner] = useState(currentOwner ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = nextStatuses(status);
  const needsOwner = target === 'assigned' && !currentOwner;
  const needsNote = target === 'dismissed';

  function move(to: InsightStatus) {
    // Two-step only where the move needs something typed. Everything else goes on the
    // first click rather than making a person confirm a reversible change.
    if ((to === 'assigned' && !currentOwner) || to === 'dismissed') {
      setTarget(to);
      setError(null);
      return;
    }
    submit(to);
  }

  function submit(to: InsightStatus) {
    setError(null);
    start(async () => {
      try {
        await api(`/api/ai/insights/${id}`, {
          method: 'PATCH',
          json: {
            status: to,
            ownerEmail: owner || undefined,
            reviewNote: note.trim() || undefined,
          },
        });
        setTarget(null);
        setNote('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {target === null ? (
        options.map((to) => (
          <Button
            key={to}
            type="button"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={pending}
            onClick={() => move(to)}
          >
            {STATUS_LABELS[to]}
          </Button>
        ))
      ) : (
        <>
          {needsOwner ? (
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="h-6 rounded border border-input bg-background px-1 text-[11px]"
            >
              <option value="">Choose an owner…</option>
              {owners.map((o) => (
                <option key={o.email} value={o.email}>
                  {o.name ?? o.email}
                </option>
              ))}
            </select>
          ) : null}

          {needsNote ? (
            <Input
              aria-label="Why this is being dismissed"
              placeholder="Why — one line"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-6 w-56 text-[11px]"
            />
          ) : null}

          <Button
            type="button"
            className="h-6 px-2 text-[11px]"
            disabled={pending}
            onClick={() => submit(target)}
          >
            {pending ? 'Saving…' : STATUS_LABELS[target]}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={pending}
            onClick={() => {
              setTarget(null);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </>
      )}

      {error ? <p className="basis-full text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
