'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/use-api-action';

export function NoteBox(parent: {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const { busy, error, run } = useBooleanApiAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await run(async () => {
      await api('/api/notes', { method: 'POST', json: { ...parent, body: body.trim() } });
      setBody('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={2}
      />
      <ErrorText error={error} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}
