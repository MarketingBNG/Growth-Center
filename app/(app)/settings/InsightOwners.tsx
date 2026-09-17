'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/shared/fetcher';
import { useMutation } from '@/lib/shared/use-mutation';
import { ErrorBanner } from '@/components/patterns/state';
import { OWNER_DOMAINS, type OwnerBindings, type OwnerDomain } from '@/lib/insights/insight-owners';

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
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries((Object.keys(OWNER_DOMAINS) as OwnerDomain[]).map((d) => [d, initial[d] ?? ''])),
  );
  const { pending, error, run } = useMutation();

  function commit(domain: OwnerDomain, email: string) {
    if (email === (initial[domain] ?? '')) return;
    setValues((v) => ({ ...v, [domain]: email }));
    run(
      async () => {
        await api('/api/settings/owners', { method: 'PUT', json: { domain, email } });
      },
      () => setValues((v) => ({ ...v, [domain]: initial[domain] ?? '' })),
    );
  }

  return (
    <div className="space-y-2">
      {(Object.keys(OWNER_DOMAINS) as OwnerDomain[]).map((domain) => (
        <div key={domain} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="min-w-64 flex-1 text-xs text-muted-foreground">
            {OWNER_DOMAINS[domain]}
          </span>
          <Select
            aria-label={OWNER_DOMAINS[domain]}
            value={values[domain]}
            disabled={pending}
            onChange={(e) => commit(domain, e.target.value)}
            className="h-7 w-auto min-w-56 rounded border border-input bg-background px-1 text-xs"
          >
            <option value="">Nobody yet</option>
            {owners.map((o) => (
              <option key={o.email} value={o.email}>
                {o.name ?? o.email}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <ErrorBanner error={error} tone="compact" />
    </div>
  );
}
