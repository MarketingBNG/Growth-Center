'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { api } from '@/lib/fetcher';
import { CURRENCIES, type CurrencySettings as Settings } from '@/lib/currency';

/**
 * Which currency the workspace reports in, and what the others are worth against it.
 *
 * Editable rather than fixed because there is no exchange-rate feed here, and a rate
 * hard-coded in the source is one nobody can correct when it drifts. The figure is shown
 * plainly so it is trusted knowingly.
 */
export function CurrencySettings({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [reporting, setReporting] = useState(initial.reporting);
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(CURRENCIES.map((c) => [c.code, String(initial.rates[c.code] ?? 1)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const parsed: Record<string, number> = {};
    for (const c of CURRENCIES) {
      // The reporting currency is its own unit; sending anything else for it would be a
      // rate that contradicts the currency it is quoted against.
      const n = c.code === reporting ? 1 : Number(rates[c.code]);
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(false);
        setError(`${c.code} needs a rate above zero.`);
        return;
      }
      parsed[c.code] = n;
    }

    try {
      await api('/api/settings/currency', { method: 'PUT', json: { reporting, rates: parsed } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const others = CURRENCIES.filter((c) => c.code !== reporting);

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Report in" hint="Every money figure in the app is converted to this currency.">
        <div className="flex flex-wrap gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setReporting(c.code)}
              aria-pressed={reporting === c.code}
              className={
                reporting === c.code
                  ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                  : 'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary'
              }
            >
              {c.symbol} {c.code} · {c.label}
            </button>
          ))}
        </div>
      </Field>

      {others.map((c) => (
        <Field
          key={c.code}
          label={`${c.code} per 1 ${reporting}`}
          hint={`How many ${c.label.toLowerCase()}s one ${reporting} buys. Used for every ${c.code} amount.`}
        >
          <Input
            type="number"
            step="0.0001"
            min="0.0001"
            value={rates[c.code] ?? ''}
            onChange={(e) => setRates((r) => ({ ...r, [c.code]: e.target.value }))}
          />
        </Field>
      ))}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {saved && !error ? (
        <p className="text-xs text-success">Saved. Figures across the app now use it.</p>
      ) : null}

      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save currency'}
      </Button>
    </form>
  );
}
