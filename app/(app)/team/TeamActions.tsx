'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/shared/fetcher';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/shared/use-api-action';

export function TeamActions({
  email,
  name,
  active,
  isSelf,
  isAdmin,
  namePinned,
}: {
  email: string;
  name: string;
  active: boolean;
  isSelf: boolean;
  isAdmin: boolean;
  namePinned: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const { busy, error, run, setError } = useBooleanApiAction();

  async function send(json: Record<string, unknown>) {
    await run(async () => {
      await api('/api/settings/users', { method: 'PATCH', json: { email, ...json } });
      setEditing(false);
      router.refresh();
    });
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
        <ErrorText error={error} as="span" />
      </form>
    );
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <ErrorText error={error} as="span" />

      {/* A shared mailbox has its name pinned in lib/roles.ts. A person does not. */}
      {namePinned ? null : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
          Rename
        </Button>
      )}

      {isAdmin ? (
        <span className="text-xs text-muted-foreground">Admin — cannot be revoked</span>
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
