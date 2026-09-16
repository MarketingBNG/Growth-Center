'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/shared/fetcher';
import { ErrorText } from '@/components/patterns/state';

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
  const [error, setError] = useState<string | null>(null);

  // Driven by a server prop, so picking a stage snapped the control straight back to the
  // old one — React re-asserts the prop — and it stayed wrong for the second or two the
  // PATCH and the refresh took. The same fix the lead selects already carry: show the
  // choice at once, and let it fall back to the server's answer when the transition ends.
  const [pending, startTransition] = useTransition();
  const [shown, show] = useOptimistic(stageId);

  function move(next: string) {
    startTransition(async () => {
      show(next);
      setError(null);
      try {
        await api(`/api/pipeline/opportunities/${dealId}`, {
          method: 'PATCH',
          json: { stageId: next },
        });
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <ErrorText error={error} as="span" />
      <Select
        aria-label="Stage"
        className="w-auto"
        value={shown}
        disabled={pending}
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
