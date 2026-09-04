'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';

/**
 * §22's budget envelope: what the firm decided to spend on each channel this quarter,
 * and what it has spent.
 *
 * Distinct from the pacing gauge above it, which reads the ad platform's own budgets and
 * says so. That answers "is Meta doing as it was told"; this answers "are we inside what
 * we decided", which is the question §22 asks and which nothing recorded until now.
 *
 * Editable only by the owner. Everyone else reads it — an envelope is an instruction, and
 * the people spending against it need to see it.
 */
export type Row = {
  channelId: string;
  channelName: string;
  /** Already formatted server-side, in the reporting currency. */
  envelope: string;
  spent: string;
  usedPercent: number | null;
  breached: boolean;
  setBy: string | null;
  /** The raw amount, for the input to start from. */
  amount: number;
  currency: string;
};

export function BudgetEnvelopes({
  rows,
  period,
  canEdit,
  currency,
}: {
  rows: Row[];
  period: { label: string; start: string; end: string };
  canEdit: boolean;
  currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(channelId: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Give an amount of zero or more.');
      return;
    }
    setError(null);
    start(async () => {
      try {
        await api('/api/budget', {
          method: 'PUT',
          json: {
            channelId,
            periodStart: period.start,
            periodEnd: period.end,
            amount: Math.round(amount),
            currency,
          },
        });
        setEditing(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <Card className="mb-[18px]">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Budget envelope · {period.label}</CardTitle>
          <span className="text-[11px] text-muted-foreground">
            What the firm decided to spend, not what the ad platform was told
          </span>
        </div>

        {/* Said whenever nothing is set, and it is not an empty state: the rows below are
            every channel that carries spend, each offering to have an envelope set. An
            empty card with nothing to act on would be the wrong answer to "no envelope
            yet", because setting the first one is the entire job. */}
        {rows.every((r) => r.amount === 0) ? (
          <p className="text-xs text-muted-foreground">
            No envelope is set for this quarter, so spend is being measured against the ad
            platform’s own budgets instead.
            {canEdit ? ' Set one per channel below.' : ' Only an owner can set one.'}
          </p>
        ) : null}

        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.channelId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-[120px] flex-1 text-xs font-medium">{r.channelName}</span>

              {editing === r.channelId ? (
                <>
                  <Input
                    aria-label={`Envelope for ${r.channelName}`}
                    type="number"
                    min={0}
                    step={1000}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="h-7 w-32 text-xs"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => save(r.channelId)}
                    className="h-7 rounded bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(null); setError(null); }}
                    className="h-7 px-1.5 text-[11px] text-muted-foreground"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="w-28 text-right text-xs tabular-nums">{r.spent}</span>
                  <span className="text-[11px] text-muted-foreground">of</span>
                  <span className="w-28 text-xs tabular-nums">
                    {r.amount === 0 ? <span className="text-muted-foreground">not set</span> : r.envelope}
                  </span>
                  {/* A bar is the whole point of the card: a percentage is a number to
                      read, a bar at its end is a thing you see. Capped at full width, so
                      the overspend is carried by the colour and the figure beside it
                      rather than by a bar running off the card. */}
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`block h-full rounded-full ${r.breached ? 'bg-destructive' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, r.usedPercent ?? 0)}%` }}
                    />
                  </span>
                  <span
                    className={`w-14 text-right text-[11px] tabular-nums ${r.breached ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {r.usedPercent === null ? '—' : `${Math.round(r.usedPercent)}%`}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => { setEditing(r.channelId); setValue(String(r.amount)); setError(null); }}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {r.amount === 0 ? 'Set' : 'Change'}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>

        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </CardHeader>
    </Card>
  );
}
