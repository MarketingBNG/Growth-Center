'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

export function CompleteButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tasks/${taskId}`, { method: 'POST', json: {} });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) return <span className="text-[11px] text-destructive">{error}</span>;

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={complete}>
      <Check /> {busy ? 'Saving…' : 'Done'}
    </Button>
  );
}
