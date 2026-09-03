'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

// Each run replaces the whole saved set, so the label says "Regenerate" once there is
// something to replace — "Generate" over existing findings reads as though it would add to
// them.

export function GenerateInsightsButton({ configured, existing }: { configured: boolean; existing: number }) {
  const router = useRouter();
  // The findings are rendered by the server component around this button, so a run is not
  // finished when the request returns — it is finished when the refreshed page has painted.
  // Without waiting for the transition the panel showed "Wrote 4 findings" directly above
  // "None yet", which is the two halves of the same screen disagreeing.
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ written: number; usage?: { input: number; output: number } } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await api<{ written: number; usage?: { input: number; output: number } }>(
        '/api/ai/insights',
        { method: 'POST', json: {} },
      );
      startTransition(() => router.refresh());
      setDone(result);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const working = busy || pending;

  if (!configured) return null;

  return (
    <div className="space-y-1.5">
      <Button size="sm" variant="secondary" onClick={run} disabled={working} className="w-full">
        <RefreshCw className={working ? 'animate-spin' : undefined} />
        {working ? 'Reading the numbers…' : existing ? 'Regenerate' : 'Generate insights'}
      </Button>

      {done && !pending ? (
        <p className="text-[11px] text-muted-foreground">
          Wrote {done.written} {done.written === 1 ? 'finding' : 'findings'}
          {done.usage
            ? `, ${done.usage.input.toLocaleString('en-US')} tokens in and ${done.usage.output.toLocaleString('en-US')} out.`
            : '.'}
        </p>
      ) : null}

      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
