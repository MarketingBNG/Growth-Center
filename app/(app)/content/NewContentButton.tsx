'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';
import { CONTENT_STATUSES } from '@/lib/enums';

const FORMATS = ['blog', 'video', 'social', 'email', 'landing_page', 'case_study'] as const;

export function NewContentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = (form.get(k) as string | null)?.trim();
      return v ? v : undefined;
    };
    try {
      await api('/api/content', {
        method: 'POST',
        json: {
          title: value('title'),
          status: value('status') ?? 'idea',
          format: value('format') ?? 'blog',
          brief: value('brief'),
          tags: [],
        },
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus /> New piece</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New content piece">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Title" required>
            <Input name="title" required autoFocus maxLength={200} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select name="status" defaultValue="idea">
                {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Format">
              <Select name="format" defaultValue="blog">
                {FORMATS.map((f) => <option key={f} value={f}>{f.replaceAll('_', ' ')}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Brief">
            <Textarea name="brief" rows={3} maxLength={4000} />
          </Field>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
