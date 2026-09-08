'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { api } from '@/lib/fetcher';
import { OWNER_DOMAINS, type OwnerBindings, type OwnerDomain } from '@/lib/insight-owners';

/**
 * Who each kind of finding lands on. §5.2.
 *
 * One row per desk, saving on its own — the same shape as the thresholds card beside it,
 * and for the same reason: binding the SEO desk to somebody is one decision, and an audit
 * row saying eight bindings changed when one did would hide it.
 *
 * A blank field is a real setting, not an empty form. It means nobody is at that desk, and
 * the rules raise a configuration finding saying so rather than routing findings to a
 * person who has left.
 */
export function InsightOwners({
  initial,
  owners,
}: {
  initial: OwnerBindings;
  owners: { email: string; name: string | null }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries((Object.keys(OWNER_DOMAINS) as OwnerDomain[]).map((d) => [d, initial[d] ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function commit(domain: OwnerDomain, email: string) {
    if (email === (initial[domain] ?? '')) return;
    setValues((v) => ({ ...v, [domain]: email }));
    setError(null);
    start(async () => {
      try {
        await api('/api/settings/owners', { method: 'PUT', json: { domain, email } });
        router.refresh();
      } catch (e) {
        setValues((v) => ({ ...v, [domain]: initial[domain] ?? '' }));
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div className="space-y-2">
      {(Object.keys(OWNER_DOMAINS) as OwnerDomain[]).map((domain) => (
        <div key={domain} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="min-w-64 flex-1 text-xs text-muted-foreground">
            {OWNER_DOMAINS[domain]}
          </span>
          <select
            value={values[domain]}
            disabled={pending}
            onChange={(e) => commit(domain, e.target.value)}
            className="h-7 min-w-56 rounded border border-input bg-background px-1 text-xs"
          >
            <option value="">Nobody yet</option>
            {owners.map((o) => (
              <option key={o.email} value={o.email}>
                {o.name ?? o.email}
              </option>
            ))}
          </select>
        </div>
      ))}
      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
