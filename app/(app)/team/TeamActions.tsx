'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

export function TeamActions({
  email,
  active,
  isSelf,
}: {
  email: string;
  active: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/settings/users', { method: 'PATCH', json: { email, active: !active } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isSelf) return <span className="text-xs text-muted-foreground">That&apos;s you</span>;

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button size="sm" variant={active ? 'outline' : 'default'} disabled={busy} onClick={toggle}>
        {busy ? '…' : active ? 'Revoke access' : 'Restore access'}
      </Button>
    </span>
  );
}
