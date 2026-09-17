'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/shared/fetcher';
import { useMutation } from '@/lib/shared/use-mutation';
import { ErrorText } from '@/components/patterns/state';
import {
  APPROVAL_STATE,
  STATUS_LABELS,
  nextStatuses,
  type InsightStatus,
} from '@/lib/insights/insight-lifecycle';

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
  canApprove,
}: {
  id: string;
  status: InsightStatus;
  owners: { email: string; name: string | null }[];
  currentOwner: string | null;
  canApprove: boolean;
}) {
  const [target, setTarget] = useState<InsightStatus | null>(null);
  const [owner, setOwner] = useState(currentOwner ?? '');
  const [note, setNote] = useState('');
  const { pending, error, setError, run } = useMutation();

  // Approval is the one move that belongs to a single identity. Offered only to whoever
  // holds it: the route refuses it regardless, and a button that always fails teaches
  // people to ignore the row it sits on.
  const options = nextStatuses(status).filter((to) => to !== APPROVAL_STATE || canApprove);
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
    run(async () => {
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
            className="h-6 px-2 text-meta"
            disabled={pending}
            onClick={() => move(to)}
          >
            {STATUS_LABELS[to]}
          </Button>
        ))
      ) : (
        <>
          {needsOwner ? (
            <Select
              aria-label="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              // The size this row was built around, kept. Only the open list changes:
              // Select's default is a full-width h-9 control, which would break a row
              // meant to sit inline beside a note field and two buttons.
              className="h-6 w-auto rounded border border-input bg-background px-1 text-meta"
            >
              <option value="">Choose an owner…</option>
              {owners.map((o) => (
                <option key={o.email} value={o.email}>
                  {o.name ?? o.email}
                </option>
              ))}
            </Select>
          ) : null}

          {needsNote ? (
            <Input
              aria-label="Why this is being dismissed"
              placeholder="Why — one line"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-6 w-56 text-meta"
            />
          ) : null}

          <Button
            type="button"
            className="h-6 px-2 text-meta"
            disabled={pending}
            onClick={() => submit(target)}
          >
            {pending ? 'Saving…' : STATUS_LABELS[target]}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-6 px-2 text-meta"
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

      <ErrorText error={error} size="meta" className="basis-full" />
    </div>
  );
}
