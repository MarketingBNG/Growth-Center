'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

// §15.4's manual trigger. The nightly cron does this too; this is for the first run and
// for the morning after a batch of articles goes live.

type Result = {
  published: { created: number; skipped: number; scanned: number };
  scheduled: { created: number };
};

export function AutofillButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setSaid(null);
    try {
      const r = await api<Result>('/api/content/autofill', { method: 'POST' });
      const made = r.published.created + r.scheduled.created;
      // "Nothing new" is a different sentence from "nothing happened", and the button has
      // to be able to say the first — otherwise a working job looks broken.
      setSaid(
        made === 0
          ? `Nothing new. ${r.published.scanned} pages checked.`
          : `Added ${made} item${made === 1 ? '' : 's'}.`,
      );
      router.refresh();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {said ? <span className="text-xs text-muted-foreground">{said}</span> : null}
      <Button variant="secondary" size="sm" onClick={run} disabled={busy}>
        <DownloadCloud className="size-3.5" />
        {busy ? 'Filling…' : 'Fill from the site'}
      </Button>
    </span>
  );
}
