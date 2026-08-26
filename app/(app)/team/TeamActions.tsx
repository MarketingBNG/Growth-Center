'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';

export function TeamActions({
  email,
  name,
  active,
  isSelf,
  isAdmin,
}: {
  email: string;
  name: string;
  active: boolean;
  isSelf: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  async function send(json: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/settings/users', { method: 'PATCH', json: { email, ...json } });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form
        className="flex items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send({ name: draft });
        }}
      >
        <Input
          aria-label="Name"
          className="h-8 w-40"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button size="sm" type="submit" disabled={busy || !draft.trim()}>
          {busy ? '…' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(name);
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </form>
    );
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}

      {/* The admin's name is fixed in lib/roles.ts — it is a shared mailbox, not a person. */}
      {isAdmin ? null : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
          Rename
        </Button>
      )}

      {isAdmin ? (
        <span className="text-xs text-muted-foreground">Cannot be revoked</span>
      ) : isSelf ? (
        <span className="text-xs text-muted-foreground">That&apos;s you</span>
      ) : (
        <Button
          size="sm"
          variant={active ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => send({ active: !active })}
        >
          {busy ? '…' : active ? 'Revoke access' : 'Restore access'}
        </Button>
      )}
    </span>
  );
}
