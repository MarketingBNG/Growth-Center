'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/shared/fetcher';
import { ErrorBanner } from '@/components/patterns/state';

// Preview first, apply second, never one click.
//
// The apply writes to Zoho and logs an activity on every lead it moves, and the person
// losing forty of them is not the person pressing the button. So the plan is shown in full
// — who gives, who receives, how many — and nothing is written until it is approved.

type Preview = {
  plan: {
    fairShare: number;
    target: number;
    moves: { leadId: string; from: string | null; to: string }[];
    before: Record<string, number>;
    after: Record<string, number>;
    deferred: number;
  };
  owners: string[];
  untouched: number;
};

type Applied = {
  moved: number;
  failed: { leadId: string; reason: string }[];
  target: number;
  deferred: number;
};

const shortName = (email: string) => email.split('@')[0].replace(/[._]/g, ' ');

export function RebalanceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setPreview(null);
    setApplied(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await api<Preview>('/api/allocation'));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Applied>('/api/allocation', { method: 'POST', json: {} });
      setApplied(result);
      // The table behind the modal lists owners, so it is wrong the moment this succeeds.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  // Rendered per pair rather than per lead: 200 rows of lead ids tell nobody anything,
  // and "vidhi → rikshita, 96 leads" is the decision actually being approved.
  const pairs = preview
    ? [...preview.plan.moves.reduce((map, move) => {
        const key = `${move.from ?? 'unassigned'}\u0000${move.to}`;
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>())]
        .map(([key, count]) => {
          const [from, to] = key.split('\u0000');
          return { from, to, count };
        })
        .sort((a, b) => b.count - a.count)
    : [];

  return (
    <>
      <Button size="sm" variant="secondary" onClick={show}>
        <Scale /> Rebalance
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Share out untouched leads"
        description="Only leads the CRM still calls untouched. Anything already worked stays where it is."
      >
        {busy && !preview ? <p className="text-xs text-muted-foreground">Working out the split…</p> : null}

        {applied ? (
          <div className="space-y-3">
            <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              Moved {applied.moved} {applied.moved === 1 ? 'lead' : 'leads'}. Everyone is now at
              about {applied.target}.
            </p>
            {applied.deferred > 0 ? (
              <p className="text-xs text-muted-foreground">
                {applied.deferred} more would even things out further — run it again to continue.
                The cap is deliberate: it keeps one run from moving thousands of leads at once.
              </p>
            ) : null}
            {applied.failed.length ? (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <p className="font-medium">
                  {applied.failed.length} the CRM did not accept, so they were left where they were:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {applied.failed.slice(0, 5).map((f) => (
                    <li key={f.leadId}>{f.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {preview && !applied ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Untouched" value={preview.untouched.toLocaleString('en-US')} />
              <Stat label="People" value={String(preview.owners.length)} />
              <Stat label="Fair share" value={String(preview.plan.target)} />
            </div>

            {/* The roster is the input most likely to be wrong, and the only one nobody can
                check from the numbers above — so the rule that built it is stated, and the
                names it produced are one click away. */}
            <details className="rounded-md border border-border px-3 py-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Sharing between everyone who currently holds an open lead
              </summary>
              <p className="mt-2 capitalize leading-relaxed text-muted-foreground">
                {preview.owners.map(shortName).join(', ')}
              </p>
            </details>

            {pairs.length ? (
              <>
                <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {pairs.map((pair) => (
                    <li
                      key={`${pair.from}-${pair.to}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <span className="truncate capitalize">
                        {pair.from === 'unassigned' ? 'Unassigned' : shortName(pair.from)}
                        <span className="px-1.5 text-muted-foreground">→</span>
                        <span className="capitalize">{shortName(pair.to)}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {pair.count} {pair.count === 1 ? 'lead' : 'leads'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {preview.plan.moves.length} leads move, oldest first — the ones that have waited
                  longest for a call.
                  {preview.plan.deferred > 0
                    ? ` ${preview.plan.deferred.toLocaleString('en-US')} more are held back for a later run.`
                    : ''}
                </p>
              </>
            ) : (
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                Nothing to move — untouched leads are already spread evenly enough across{' '}
                {preview.owners.length} people.
              </p>
            )}
          </div>
        ) : null}

        <ErrorBanner error={error} className="mt-3" />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {applied ? 'Done' : 'Cancel'}
          </Button>
          {preview && !applied && preview.plan.moves.length ? (
            <Button type="button" onClick={apply} disabled={busy}>
              {busy ? 'Moving…' : `Move ${preview.plan.moves.length} leads`}
            </Button>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
