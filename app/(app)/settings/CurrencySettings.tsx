'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { api } from '@/lib/fetcher';
import {
  CURRENCIES,
  RATE_STALE_HOURS,
  rateAgeHours,
  type CurrencySettings as Settings,
} from '@/lib/currency';

/**
 * Which currency the workspace reports in, and what the others are worth against it.
 *
 * Live by default, because a rate typed in once is a rate that quietly goes stale — the
 * placeholder this replaced was 9% out within a few months, and a 9% error in every
 * converted total is invisible on screen. Manual stays available for a workspace that
 * reports at a fixed internal rate.
 */
export function CurrencySettings({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [reporting, setReporting] = useState(initial.reporting);
  const [mode, setMode] = useState(initial.mode);
  const [current, setCurrent] = useState(initial);
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(CURRENCIES.map((c) => [c.code, String(initial.rates[c.code] ?? 1)])),
  );
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const applied = (next: Settings) => {
    setCurrent(next);
    setRates(Object.fromEntries(CURRENCIES.map((c) => [c.code, String(next.rates[c.code] ?? 1)])));
    setReporting(next.reporting);
    setMode(next.mode);
    router.refresh();
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setSaved(false);

    const parsed: Record<string, number> = {};
    for (const c of CURRENCIES) {
      // The reporting currency is its own unit; sending anything else for it would be a
      // rate that contradicts the currency it is quoted against.
      const n = c.code === reporting ? 1 : Number(rates[c.code]);
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(null);
        setError(`${c.code} needs a rate above zero.`);
        return;
      }
      parsed[c.code] = n;
    }

    try {
      const out = await api<{ currency: Settings }>('/api/settings/currency', {
        method: 'PUT',
        json: { reporting, mode, rates: parsed },
      });
      applied(out.currency);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy('refresh');
    setError(null);
    setSaved(false);
    try {
      const out = await api<{ currency: Settings }>('/api/settings/currency', { method: 'POST' });
      applied(out.currency);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const others = CURRENCIES.filter((c) => c.code !== reporting);
  const age = rateAgeHours(current);
  const stale = current.mode === 'live' && (age === null || age >= RATE_STALE_HOURS);

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

      <Field
        label="Exchange rate"
        hint="Live rates come from the European Central Bank's daily reference rate, refreshed automatically."
      >
        <div className="flex flex-wrap gap-2">
          {(['live', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={
                mode === m
                  ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                  : 'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary'
              }
            >
              {m === 'live' ? 'Live' : 'Fixed rate'}
            </button>
          ))}
        </div>
      </Field>

      {others.map((c) => (
        <Field
          key={c.code}
          label={`${c.code} per 1 ${reporting}`}
          hint={
            mode === 'live'
              ? 'Set automatically. Switch to a fixed rate to type your own.'
              : `How many ${c.label.toLowerCase()}s one ${reporting} buys.`
          }
        >
          <Input
            type="number"
            step="0.0001"
            min="0.0001"
            disabled={mode === 'live'}
            value={rates[c.code] ?? ''}
            onChange={(e) => setRates((r) => ({ ...r, [c.code]: e.target.value }))}
          />
        </Field>
      ))}

      {current.mode === 'live' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button type="button" variant="secondary" onClick={refresh} disabled={busy !== null}>
            <RefreshCw className={busy === 'refresh' ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
          </Button>
          <span>
            {current.fetchedAt
              ? `Updated ${age !== null && age < 1 ? 'less than an hour' : `${Math.round(age ?? 0)}h`} ago · ${current.source ?? 'unknown source'}`
              : 'Never fetched — the figures below are a starting point, not a live rate.'}
          </span>
        </div>
      ) : null}

      {/* A rate that silently stopped refreshing is a wrong number that looks exactly like
          a right one, so its age is stated rather than assumed. */}
      {stale ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          These rates are older than a day and a half. Every converted figure is using
          them until a refresh succeeds.
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {saved && !error ? (
        <p className="text-xs text-success">Saved. Figures across the app now use it.</p>
      ) : null}

      <Button type="submit" disabled={busy !== null}>
        {busy === 'save' ? 'Saving…' : 'Save currency'}
      </Button>
    </form>
  );
}
