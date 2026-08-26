'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

/**
 * Completing was one-way: a task ticked off by mistake stayed done for good, because
 * nothing ever called anything but the complete path.
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

  if (error) return <span className="text-[11px] text-destructive">{error}</span>;

  if (done) {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => set('open')}>
        <Undo2 /> {busy ? 'Saving…' : 'Reopen'}
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => set('done')}>
      <Check /> {busy ? 'Saving…' : 'Done'}
    </Button>
  );
}
