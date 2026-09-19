'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/shared/use-api-action';
import { FACT_STATUS_LABELS, factTone, jurisdictionLabel } from '@/lib/content/facts-fields';
import { fmtDate } from '@/lib/shared/format';

type Fact = {
  id: string;
  key: string;
  label: string;
  value: string;
  unit: string | null;
  jurisdiction: string;
  authority: string | null;
  sourceUrl: string;
  sourceExcerpt: string;
  status: string;
  reviewerEmail: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdBy: string | null;
};

/**
 * One fact, and whatever can be done to it from here.
 *
 * The source excerpt is shown rather than linked-to on the review rows. A reviewer
 * clearing a tax threshold should not have to open a tab to see the sentence the claim
 * rests on — if checking is inconvenient, clearing without checking is what happens, and
 * the register becomes a list of numbers with a tick beside them.
 */
export function FactRow({
  fact,
  canReview,
  canWrite,
  expanded = false,
}: {
  fact: Fact;
  canReview: boolean;
  canWrite: boolean;
  expanded?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(expanded);
  const [note, setNote] = useState('');
  const { busy, error, run, setError } = useBooleanApiAction();

  async function act(action: 'propose' | 'approve' | 'refuse') {
    setError(null);
    await run(async () => {
      const res = await fetch(`/api/facts/${fact.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: note || null }),
      });
      const text = await res.text();
      const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      if (!res.ok) throw new Error((parsed.error as string) || `Failed (${res.status})`);
      setNote('');
      router.refresh();
    });
  }

  const expiry =
    fact.effectiveTo && fact.effectiveTo < new Date()
      ? `Expired ${fmtDate(fact.effectiveTo)}`
      : fact.effectiveTo
        ? `Until ${fmtDate(fact.effectiveTo)}`
        : null;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs font-semibold">{fact.key}</code>
            <Badge tone={factTone(fact.status)}>{FACT_STATUS_LABELS[fact.status] ?? fact.status}</Badge>
            <Badge>{jurisdictionLabel(fact.jurisdiction)}</Badge>
            {/* A threshold that has lapsed is worse than a missing one: it reads as
                current. Said on the row, not buried in the detail. */}
            {expiry ? <Badge tone={expiry.startsWith('Expired') ? 'danger' : 'neutral'}>{expiry}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{fact.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg tnum font-semibold">{fact.value}</span>
          <Button variant="ghost" size="action" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Source'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <blockquote className="border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
            “{fact.sourceExcerpt}”
          </blockquote>
          <p className="text-meta text-muted-foreground">
            {fact.authority ? <span className="font-medium text-foreground">{fact.authority} · </span> : null}
            <a
              href={fact.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              {fact.sourceUrl} <ExternalLink className="size-3" />
            </a>
          </p>

          <p className="text-meta text-muted-foreground">
            Entered by {fact.createdBy ?? 'unknown'}
            {fact.reviewedAt
              ? ` · ${fact.status === 'approved' ? 'cleared' : 'reviewed'} by ${fact.reviewerEmail} on ${fmtDate(fact.reviewedAt)}`
              : ' · not yet reviewed'}
          </p>

          {fact.reviewNote ? (
            <p className="rounded-md bg-secondary/50 p-2 text-meta text-muted-foreground">
              Reviewer: {fact.reviewNote}
            </p>
          ) : null}

          <ErrorText error={error} />

          {fact.status === 'draft' && canWrite ? (
            <Button size="action" disabled={busy} onClick={() => act('propose')}>
              {busy ? 'Sending…' : 'Send for review'}
            </Button>
          ) : null}

          {fact.status === 'proposed' && canReview ? (
            <div className="space-y-2">
              <Input
                placeholder="Note — required to refuse, optional to clear"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="action" disabled={busy} onClick={() => act('approve')}>
                  {busy ? 'Saving…' : 'Clear this fact'}
                </Button>
                <Button size="action" variant="outline" disabled={busy} onClick={() => act('refuse')}>
                  Refuse
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
