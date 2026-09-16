'use client';

import { useRouter } from 'next/navigation';
import { formValues } from '@/components/patterns/form';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { api } from '@/lib/shared/fetcher';
import { CONTENT_STATUSES } from '@/lib/shared/enums';
import { FORMAT_LABELS, FORMATS, MAX_BRIEF } from '@/lib/content/content-fields';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/shared/use-api-action';

export function NewContentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useBooleanApiAction();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = formValues(e.currentTarget);
    await run(async () => {
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
    });
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
                {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Brief">
            <Textarea name="brief" rows={3} maxLength={MAX_BRIEF} />
          </Field>
          <ErrorText error={error} />
          <ModalFooter onCancel={() => setOpen(false)} busy={busy} submit="Create" />
        </form>
      </Modal>
    </>
  );
}
