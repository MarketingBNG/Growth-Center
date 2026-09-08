'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';
import type { CapacitySetting } from '@/lib/capacity';

// §6.2's monthly manual input.
//
// The manual marks its own source as unconfirmed and it was right to: Zoho Projects
// measures load, and a ceiling is a judgement about how many new consultations senior
// delivery time can absorb. Nothing in any connected system holds one, so it is entered
// here — by a person, with their name against it.

export function Capacity({ initial }: { initial: CapacitySetting }) {
  const router = useRouter();
  const [value, setValue] = useState(
    initial.monthlyConsultations === null ? '' : String(initial.monthlyConsultations),
  );
  const [note, setNote] = useState(initial.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/api/settings/capacity', {
        method: 'PUT',
        json: {
          // Blank clears the ceiling rather than storing zero. A ceiling of zero means
          // "take on nothing this month", which is a real instruction and not the same as
          // "nobody has decided" — and the card says something different for each.
          monthlyConsultations: value.trim() === '' ? null : Number(value),
          note: note.trim() || null,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">New consultations per month</span>
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Not set"
            className="w-36 rounded-md border border-border bg-background px-2 py-1.5 text-xs tnum"
          />
        </label>
        <label className="flex-1 text-xs">
          <span className="mb-1 block text-muted-foreground">Why this number</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Two senior reviewers, four days a week…"
            className="w-full min-w-[220px] rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
        </label>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {saved ? <p className="text-xs text-success">Saved and recorded in the activity log.</p> : null}

      <p className="text-meta text-muted-foreground">
        Blank means no ceiling has been decided, and the dashboard says so rather than
        defaulting — a default ceiling is a number nobody chose being used to authorise
        spending. Zero is different and is a real instruction: take on nothing this month.
        {initial.setByEmail ? ` Last set by ${initial.setByEmail.split('@')[0]}.` : ''}
      </p>
    </div>
  );
}
