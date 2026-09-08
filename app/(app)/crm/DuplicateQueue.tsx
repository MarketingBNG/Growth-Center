'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Copy, Search, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/fetcher';
import { fmtRelative } from '@/lib/format';
import type { QueueRow } from '@/lib/duplicate-queue';

// §8.1's front end. The engine proposes; this is where a person decides.
//
// Both records are shown in full, side by side, with what each one carries — deals,
// activities, notes. That is the whole reason a queue exists rather than an automatic
// merge: the counts are what tell somebody that the record on the left is a stub and the
// one on the right is the real account, and no rule can see that as reliably as a person
// glancing at "0 records" beside "14 records".

type Props = {
  rows: QueueRow[];
  counts: { pending: number; merged: number; dismissed: number };
  canManage: boolean;
};

export function DuplicateQueue({ rows, counts, canManage }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which row is being dismissed, and the reason typed so far. A dismissal needs a note,
  // so it cannot be a single button the way a merge can.
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // The merge just made, offered back. A merge deletes a record, so it is the one action
  // on this screen that doing the opposite cannot fix — and the mistake it guards against
  // is the misread row, which is noticed immediately or not at all. So it is held here
  // until the next action rather than parked in a history somewhere.
  const [undoable, setUndoable] = useState<{ id: string; label: string } | null>(null);

  async function act(
    id: string,
    body: { action: 'merge' } | { action: 'dismiss'; reason: string } | { action: 'unmerge' },
    label?: string,
  ) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/duplicates/${id}`, { method: 'POST', json: body });
      setDismissing(null);
      setReason('');
      setUndoable(body.action === 'merge' && label ? { id, label } : null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy('scan');
    setError(null);
    try {
      await api('/api/duplicates', { method: 'POST' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-[18px] overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Duplicate merge queue</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {counts.pending === 0
              ? 'Nothing waiting. The nightly sync scans the last six months after it imports, so a duplicate created overnight appears here in the morning.'
              : `${counts.pending} pair${counts.pending === 1 ? '' : 's'} to decide. ${counts.merged} merged, ${counts.dismissed} rejected so far.`}
          </p>
        </div>
        {canManage ? (
          <Button variant="secondary" size="sm" onClick={scan} disabled={busy !== null}>
            <Search className="size-3.5" />
            {busy === 'scan' ? 'Scanning…' : 'Scan now'}
          </Button>
        ) : null}
      </CardHeader>

      {error ? (
        <div className="mx-4 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* Sits where the merged row was, so the offer is where the eye already is. It says
          what happened before it offers to reverse it: "Undo" alone leaves somebody
          guessing which of two records went. */}
      {undoable ? (
        <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2">
          <p className="text-xs">
            Merged <span className="font-medium">{undoable.label}</span> away. The record was
            deleted and its deals, notes and tasks moved across.
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => act(undoable.id, { action: 'unmerge' })}
            >
              <Undo2 className="size-3.5" />
              {busy === undoable.id ? 'Putting it back…' : 'Undo'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setUndoable(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {/* Never a bare "0". The card read "Duplicates merged: 0" for months while
              nothing was scanning at all, and the two states have to be tellable apart. */}
          {counts.merged + counts.dismissed === 0
            ? 'No scan has run yet.'
            : 'Every pair found so far has been decided.'}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((row) => {
            const stale = !row.primary || !row.duplicate;
            return (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
                  <span className="rounded border border-border px-1.5 py-px uppercase tracking-wide">
                    {row.entityType}
                  </span>
                  <span>
                    {row.ruleLabel}: <span className="font-mono">{row.matchedOn}</span>
                  </span>
                  <span>· {row.confidence}% confident</span>
                  <span>· found {fmtRelative(row.detectedAt)}</span>
                </div>

                {stale ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    One of these records no longer exists — merged in the CRM, most likely. Reject
                    the pair to clear it.
                  </p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {/* Left is the record proposed to survive, and it is labelled as
                        such: without that the two columns are just two records and the
                        button says "merge" without saying which way round. */}
                    <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2">
                      <p className="text-micro font-semibold uppercase tracking-wide text-success">
                        Keep
                      </p>
                      <p className="mt-0.5 text-xs font-medium">{row.primary?.label}</p>
                      <p className="text-meta text-muted-foreground">{row.primary?.detail}</p>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {row.primary?.weight ?? 0} linked record
                        {(row.primary?.weight ?? 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-2">
                      <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                        Fold in and delete
                      </p>
                      <p className="mt-0.5 text-xs font-medium">{row.duplicate?.label}</p>
                      <p className="text-meta text-muted-foreground">{row.duplicate?.detail}</p>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {row.duplicate?.weight ?? 0} linked record
                        {(row.duplicate?.weight ?? 0) === 1 ? '' : 's'} — moved across first
                      </p>
                    </div>
                  </div>
                )}

                {canManage ? (
                  dismissing === row.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why are these not the same record?"
                        className="min-w-[240px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={reason.trim().length < 3 || busy !== null}
                        onClick={() => act(row.id, { action: 'dismiss', reason })}
                      >
                        Save reason
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDismissing(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      {stale ? null : (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            act(row.id, { action: 'merge' }, row.duplicate?.label ?? 'that record')
                          }
                        >
                          <Copy className="size-3.5" />
                          {busy === row.id ? 'Merging…' : 'Merge'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          setDismissing(row.id);
                          setReason('');
                        }}
                      >
                        Not a duplicate
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
