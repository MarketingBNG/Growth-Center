'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/use-api-action';

/**
 * The revoke endpoint existed from the start with no way to reach it. These keys get
 * pasted into third-party form builders, so the one moment you need this is the moment
 * one leaks — and needing a developer at the database then is the wrong answer.
 */
export function RevokeKey({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useBooleanApiAction();

  async function revoke() {
    await run(async () => {
      await api(`/api/settings/api-keys/${id}`, { method: 'DELETE' });
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Revoke
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Revoke ${name}?`}
        description="Any form still using this key stops submitting immediately. This cannot be undone — issue a new key instead."
      >
        <div className="space-y-3">
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={busy}>
              {busy ? 'Revoking…' : 'Revoke key'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
