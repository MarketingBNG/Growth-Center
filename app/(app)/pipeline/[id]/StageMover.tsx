'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/fetcher';

export function StageMover({
  dealId,
  stageId,
  stages,
}: {
  dealId: string;
  stageId: string;
  stages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(next: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/pipeline/opportunities/${dealId}`, {
        method: 'PATCH',
        json: { stageId: next },
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Select
        aria-label="Stage"
        className="w-auto"
        value={stageId}
        disabled={busy}
        onChange={(e) => move(e.target.value)}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
