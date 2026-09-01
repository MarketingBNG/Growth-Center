'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

/**
 * Completing was one-way: a task ticked off by mistake stayed done for good, because
 * nothing ever called anything but the complete path.
 *
 * Both directions now go to the CRM first and this database second, so a tick is not
 * quietly reverted by the next sync. That also means this button can fail for a reason
 * outside the app — the message it shows is the CRM's.
 */
export function CompleteButton({ taskId, done = false }: { taskId: string; done?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(status: 'open' | 'done') {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', json: { status } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The error sits beside the button rather than replacing it. A refusal from the CRM is
  // usually something the person can act on and retry — "reconnect Zoho" — and swapping
  // the control out for the message left them nothing to retry with.
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {done ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => set('open')}>
          <Undo2 /> {busy ? 'Saving…' : 'Reopen'}
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => set('done')}>
          <Check /> {busy ? 'Saving…' : 'Done'}
        </Button>
      )}
      {error ? (
        <span className="max-w-56 text-right text-[11px] leading-snug text-destructive">{error}</span>
      ) : null}
    </span>
  );
}
