'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { CONTENT_STATUSES } from '@/lib/enums';
import { safeUrl } from '@/lib/format';

export type Piece = {
  id: string;
  title: string;
  format: string;
  status: string;
  authorEmail: string | null;
  publishDate: string | null;
  views: number;
  leadsGenerated: number;
  campaignName: string | null;
  url: string | null;
  /** Derived on the server — see lib/content-approval.ts. Sent as a label rather than
   *  the raw columns, so the card cannot draw its own conclusion from them. */
  approval: { state: string; label: string; detail: string | null };
};

export function ContentCard({ piece, canApprove }: { piece: Piece; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');

  async function decide(decision: 'approve' | 'return') {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/content/${piece.id}/approval`, {
        method: 'POST',
        json: decision === 'approve' ? { decision } : { decision, note: note.trim() },
      });
      setReturning(false);
      setNote('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function move(status: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/content/${piece.id}`, { method: 'PATCH', json: { status } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className="text-sm font-medium leading-snug">{piece.title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {piece.format.replaceAll('_', ' ')}
        {piece.authorEmail ? ` · ${piece.authorEmail.split('@')[0]}` : ''}
      </p>
      {piece.campaignName ? (
        <p className="text-[11px] text-muted-foreground">{piece.campaignName}</p>
      ) : null}
      {piece.publishDate ? (
        <p className="text-[11px] text-muted-foreground">{piece.publishDate}</p>
      ) : null}

      {piece.views > 0 || piece.leadsGenerated > 0 ? (
        <p className="mt-1.5 text-[11px] tnum">
          <span className="text-muted-foreground">views</span> {piece.views.toLocaleString('en-US')}
          {' · '}
          <span className="text-muted-foreground">leads</span> {piece.leadsGenerated}
        </p>
      ) : null}

      {/* Whether this piece may go out, and on whose say-so. Above the status control
          rather than below it, because it is the thing that decides whether changing the
          status will be refused. */}
      {piece.approval.state === 'unapproved' ? null : (
        <p
          className={`mt-1.5 text-[11px] ${
            piece.approval.state === 'approved'
              ? 'text-success'
              : piece.approval.state === 'stale'
                ? 'text-warning'
                : 'text-muted-foreground'
          }`}
        >
          {piece.approval.label}
          {piece.approval.detail ? ` · ${piece.approval.detail}` : ''}
        </p>
      )}

      {canApprove && piece.status === 'review' ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {returning ? (
            <>
              <input
                aria-label="Why this is going back"
                placeholder="What needs changing"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[11px]"
              />
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => decide('return')}
                className="h-7 rounded border border-input px-2 text-[11px] disabled:opacity-50"
              >
                Send back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setReturning(false); setError(null); }}
                className="h-7 px-1.5 text-[11px] text-muted-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide('approve')}
                className="h-7 rounded bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-50"
              >
                {piece.approval.state === 'stale' ? 'Approve again' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReturning(true)}
                className="h-7 rounded border border-input px-2 text-[11px] disabled:opacity-50"
              >
                Return to author
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        <Select
          aria-label="Status"
          className="h-7 flex-1 text-[11px]"
          value={piece.status}
          disabled={busy}
          onChange={(e) => move(e.target.value)}
        >
          {CONTENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        {safeUrl(piece.url) ? (
          <a
            href={safeUrl(piece.url)!}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open published piece"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
