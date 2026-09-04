'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/fetcher';
import { ROLES, canAdminister, type Role } from '@/lib/roles';

/**
 * The Role cell on the Team page.
 *
 * The two options it greys out mirror the guards in the API exactly — an admin account and
 * your own account both have to keep a role that can reach this page. Disabling them here
 * is a courtesy; the server refuses either way, which is what actually holds.
 */
export function RoleSelect({
  email,
  role,
  isSelf,
  isAdmin,
}: {
  email: string;
  role: Role;
  isSelf: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<Role>(role);
  const [error, setError] = useState<string | null>(null);

  // Whoever must not lose their way back in: the shared admin mailboxes, and you.
  const mustAdminister = isAdmin || isSelf;

  async function change(next: Role) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      await api('/api/settings/users', { method: 'PATCH', json: { email, role: next } });
      router.refresh();
    } catch (e) {
      setValue(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Select
        aria-label={`Role for ${email}`}
        className="h-8 w-36"
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value as Role)}
      >
        {ROLES.map((r) => (
          <option
            key={r.value}
            value={r.value}
            disabled={mustAdminister && !canAdminister(r.value)}
          >
            {r.label}
          </option>
        ))}
      </Select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
