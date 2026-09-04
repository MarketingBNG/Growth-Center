'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/fetcher';
import { PURPOSE_LABELS, SEQUENCE_PURPOSES } from '@/lib/outreach-approval';
import { fmtDate } from '@/lib/format';

type SignOffView =
  | { state: 'none' }
  | { state: 'current'; byEmail: string; at: string | Date }
  | { state: 'stale'; byEmail: string; at: string | Date };

/**
 * The registry row and the two sign-offs for one sequence.
 *
 * The sign-off buttons are shown to everyone and refused by the server for anyone without
 * `approve`. Hiding them would be worse: someone who cannot approve should be able to see
 * that an approval is what the sequence is waiting for.
 */
export function SequenceRegistry({
  id,
  purpose,
  segment,
  serviceLine,
  sendingDomain,
  copy,
  numbers,
  blocked,
}: {
  id: string;
  purpose: string | null;
  segment: string | null;
  serviceLine: string | null;
  sendingDomain: string | null;
  copy: SignOffView;
  numbers: SignOffView;
  blocked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    purpose: purpose ?? '',
    segment: segment ?? '',
    serviceLine: serviceLine ?? '',
    sendingDomain: sendingDomain ?? '',
  });

  async function send(path: string, json: Record<string, unknown>, method: 'PATCH' | 'POST') {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, json });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const saveRegistry = () =>
    send(
      `/api/outreach/sequences/${id}`,
      {
        purpose: draft.purpose || null,
        segment: draft.segment.trim() || null,
        serviceLine: draft.serviceLine.trim() || null,
        sendingDomain: draft.sendingDomain.trim() || null,
      },
      'PATCH',
    );

  const signOff = (kind: 'copy' | 'numbers', granted: boolean) =>
    send(`/api/outreach/sequences/${id}/sign-off`, { kind, granted }, 'POST');

  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <Field label="Purpose" value={purpose ? PURPOSE_LABELS[purpose as keyof typeof PURPOSE_LABELS] ?? purpose : null} />
        <Field label="Segment" value={segment} />
        <Field label="Service line" value={serviceLine} />
        <Field label="Domain" value={sendingDomain} />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-[11px]"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Cancel' : 'Edit registry'}
        </Button>
      </div>

      {open ? (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Purpose
            <Select
              aria-label="Purpose"
              className="h-8"
              value={draft.purpose}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
            >
              <option value="">Not set</option>
              {SEQUENCE_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABELS[p]}
                </option>
              ))}
            </Select>
          </label>
          <TextField
            label="Segment"
            value={draft.segment}
            onChange={(v) => setDraft({ ...draft, segment: v })}
          />
          <TextField
            label="Service line"
            value={draft.serviceLine}
            onChange={(v) => setDraft({ ...draft, serviceLine: v })}
          />
          <TextField
            label="Sending domain"
            value={draft.sendingDomain}
            onChange={(v) => setDraft({ ...draft, sendingDomain: v })}
          />
          <div className="sm:col-span-4">
            <Button size="sm" disabled={busy} onClick={saveRegistry}>
              {busy ? '…' : 'Save registry'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <SignOffControl
          label="Copy approved"
          view={copy}
          blocked={blocked}
          busy={busy}
          onGrant={() => signOff('copy', true)}
          onWithdraw={() => signOff('copy', false)}
        />
        <SignOffControl
          label="Figures verified"
          view={numbers}
          blocked={blocked}
          busy={busy}
          onGrant={() => signOff('numbers', true)}
          onWithdraw={() => signOff('numbers', false)}
        />
      </div>

      {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="text-muted-foreground">
      {label}:{' '}
      <span className={value ? 'text-foreground' : 'text-muted-foreground/70'}>
        {value ?? 'not set'}
      </span>
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input className="h-8" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SignOffControl({
  label,
  view,
  blocked,
  busy,
  onGrant,
  onWithdraw,
}: {
  label: string;
  view: SignOffView;
  blocked: boolean;
  busy: boolean;
  onGrant: () => void;
  onWithdraw: () => void;
}) {
  const who = view.state === 'none' ? null : view.byEmail.split('@')[0];
  const when = view.state === 'none' ? null : fmtDate(view.at);

  return (
    <span className="flex items-center gap-2 text-[11px]">
      {view.state === 'current' ? (
        <Check className="size-3.5 shrink-0 text-success" />
      ) : view.state === 'stale' ? (
        <TriangleAlert className="size-3.5 shrink-0 text-warning" />
      ) : null}

      <span className={view.state === 'current' ? 'text-success' : 'text-muted-foreground'}>
        {label}:{' '}
        {view.state === 'none' ? (
          <span className="text-destructive">none on record</span>
        ) : view.state === 'stale' ? (
          <span className="text-warning">
            {who} on {when} — template has changed since
          </span>
        ) : (
          <span>
            {who} on {when}
          </span>
        )}
      </span>

      {view.state === 'current' ? (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={onWithdraw}>
          Withdraw
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={busy || blocked}
          // The linter's verdict disables the button as well as the server refusing it,
          // so the reason is visible before the click rather than after.
          title={blocked ? 'Fix the placeholders in the copy first' : undefined}
          onClick={onGrant}
        >
          {view.state === 'stale' ? 'Sign again' : 'Sign off'}
        </Button>
      )}
    </span>
  );
}
