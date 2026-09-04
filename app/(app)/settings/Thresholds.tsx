'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { THRESHOLDS, type ThresholdKey, type Thresholds as Values } from '@/lib/thresholds';

/**
 * The numbers the rule library compares against.
 *
 * One row per threshold, each saving on its own. A single Save for all ten would make a
 * change to one number an audit row about ten, and the audit row is the point — §20.5
 * asks for the change recorded, because lowering a threshold is how a finding stops
 * being raised.
 *
 * Saves on blur rather than on a button per row: ten buttons is a wall, and a number
 * field a person has finished typing in is a number they have finished choosing.
 */
export function Thresholds({ initial }: { initial: Values }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])),
  );
  const [saved, setSaved] = useState<ThresholdKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function commit(key: ThresholdKey) {
    const n = Number(values[key]);
    // Unchanged, so nothing is written — otherwise tabbing through the card would file an
    // audit row per field saying a number went from 30 to 30.
    if (!Number.isFinite(n) || n < 0 || n === initial[key]) {
      setValues((v) => ({ ...v, [key]: String(initial[key]) }));
      return;
    }

    setError(null);
    start(async () => {
      try {
        const out = await api<{ value: number }>('/api/settings/thresholds', {
          method: 'PUT',
          json: { key, value: Math.round(n) },
        });
        setValues((v) => ({ ...v, [key]: String(out.value) }));
        setSaved(key);
        router.refresh();
      } catch (e) {
        setValues((v) => ({ ...v, [key]: String(initial[key]) }));
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div className="space-y-3">
      {(Object.keys(THRESHOLDS) as ThresholdKey[]).map((key) => {
        const spec = THRESHOLDS[key];
        return (
          <div key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
              <label htmlFor={key} className="text-xs font-medium">
                {spec.label}
              </label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{spec.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Input
                id={key}
                type="number"
                min={0}
                step={1}
                value={values[key] ?? ''}
                disabled={pending}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                onBlur={() => commit(key)}
                className="h-7 w-20 text-xs"
              />
              <span className="w-[86px] text-[11px] text-muted-foreground">{spec.unit}</span>
              {/* Shown against the default so a reader can tell a chosen number from an
                  inherited one — which is the difference between a decision and a
                  placeholder nobody has looked at. */}
              <span className="w-[70px] text-[11px] text-muted-foreground/70">
                {Number(values[key]) === spec.default ? 'default' : `was ${spec.default}`}
              </span>
              <span className="w-10 text-[11px] text-muted-foreground">
                {saved === key ? 'Saved' : ''}
              </span>
            </div>
          </div>
        );
      })}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
