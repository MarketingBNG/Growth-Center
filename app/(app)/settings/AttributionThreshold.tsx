'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { api } from '@/lib/fetcher';

/**
 * How much of the period's revenue must reach a channel before the app will present a
 * channel ranking as a basis for moving money.
 *
 * A setting rather than a constant because it is a judgement about evidence, and the
 * right level depends on how the firm sells. It is written to the audit log for the same
 * reason: lowering it is how a qualified ranking becomes an unqualified one.
 */
export function AttributionThreshold({ initial, coverage }: { initial: number; coverage: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setError('Give a percentage between 0 and 100.');
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const out = await api<{ threshold: number }>('/api/settings/attribution', {
        method: 'PUT',
        json: { threshold: Math.round(n) },
      });
      setValue(String(out.threshold));
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const target = Number(value);
  // Shown against the live figure, so the number being typed has a referent. A threshold
  // set in the abstract is a threshold nobody can tell they have just switched off.
  const wouldPass = coverage !== null && Number.isFinite(target) && coverage >= target;

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label="Minimum revenue coverage">
        <Input
          aria-label="Minimum revenue coverage, percent"
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24"
        />
      </Field>

      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>

      <p className="text-[11px] text-muted-foreground">
        {coverage === null
          ? 'No revenue in the last year to measure against.'
          : wouldPass
            ? `Currently ${coverage.toFixed(1)}% — channel figures are presented without a caveat.`
            : `Currently ${coverage.toFixed(1)}% — below this, channel figures carry a caveat on the Marketing page.`}
      </p>

      {error ? <p className="w-full text-[11px] text-destructive">{error}</p> : null}
      {saved && !error ? <p className="w-full text-[11px] text-muted-foreground">Saved.</p> : null}
    </form>
  );
}
