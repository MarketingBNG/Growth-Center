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
import { ErrorBanner } from '@/components/patterns/state';
import { SOURCE_TYPES } from '@/lib/shared/enums';

export function NewLeadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDuplicateOf(null);

    const value = formValues(e.currentTarget);

    try {
      const result = await api<{ created: boolean; leadId: string }>('/api/leads', {
        method: 'POST',
        json: {
          firstName: value('firstName'),
          lastName: value('lastName'),
          email: value('email'),
          phone: value('phone'),
          companyName: value('companyName'),
          title: value('title'),
          message: value('message'),
          sourceType: value('sourceType') ?? 'manual',
          tags: [],
        },
      });

      if (!result.created) {
        setDuplicateOf(result.leadId);
        setBusy(false);
        return;
      }
      setOpen(false);
      router.push(`/leads/${result.leadId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New lead
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="New lead">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required>
              <Input name="firstName" required autoFocus maxLength={80} />
            </Field>
            <Field label="Last name">
              <Input name="lastName" maxLength={80} />
            </Field>
          </div>
          <Field label="Email" hint="Used to detect duplicates and link the CRM record.">
            <Input name="email" type="email" maxLength={200} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <Input name="companyName" maxLength={160} />
            </Field>
            <Field label="Phone">
              <Input name="phone" maxLength={40} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title">
              <Input name="title" maxLength={120} />
            </Field>
            <Field label="Source">
              <Select name="sourceType" defaultValue="manual">
                {SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Message">
            <Textarea name="message" maxLength={4000} rows={3} />
          </Field>

          {duplicateOf ? (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              This email already belongs to an open lead. The submission was recorded on it
              instead.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => router.push(`/leads/${duplicateOf}`)}
              >
                Open that lead
              </button>
            </p>
          ) : null}

          <ErrorBanner error={error} />

          <ModalFooter
            onCancel={() => setOpen(false)}
            busy={busy}
            submit="Create lead"
          />
        </form>
      </Modal>
    </>
  );
}

