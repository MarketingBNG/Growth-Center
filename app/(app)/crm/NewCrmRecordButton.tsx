'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';

export function NewCrmRecordButton({ kind }: { kind: 'company' | 'contact' }) {
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

    const path = kind === 'company' ? '/api/crm/companies' : '/api/crm/contacts';
    const json =
      kind === 'company'
        ? {
            name: value('name'),
            domain: value('domain'),
            phone: value('phone'),
            industry: value('industry'),
            country: value('country'),
            tags: [],
          }
        : {
            firstName: value('firstName'),
            lastName: value('lastName'),
            email: value('email'),
            title: value('title'),
            phone: value('phone'),
            tags: [],
          };

    try {
      const result = await api<{ created: boolean; id: string }>(path, { method: 'POST', json });
      setOpen(false);
      router.push(kind === 'company' ? `/crm/companies/${result.id}` : `/crm/contacts/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New {kind}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`New ${kind}`}>
        <form onSubmit={submit} className="space-y-3">
          {kind === 'company' ? (
            <>
              <Field label="Name" required>
                <Input name="name" required autoFocus maxLength={160} />
              </Field>
              <Field label="Domain" hint="Used to match future leads to this company.">
                <Input name="domain" placeholder="acme.com" maxLength={200} />
              </Field>
              {/* Phone is the column the list actually shows, and the form had no way to
                  set it — a company added by hand arrived with a blank where every
                  imported one has a number. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input name="phone" maxLength={40} />
                </Field>
                <Field label="Country">
                  <Input name="country" maxLength={80} />
                </Field>
              </div>
              <Field label="Industry" hint="Empty on every synced company; shown on the record itself.">
                <Input name="industry" maxLength={80} />
              </Field>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" required>
                  <Input name="firstName" required autoFocus maxLength={80} />
                </Field>
                <Field label="Last name">
                  <Input name="lastName" maxLength={80} />
                </Field>
              </div>
              <Field label="Email">
                <Input name="email" type="email" maxLength={200} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title">
                  <Input name="title" maxLength={120} />
                </Field>
                <Field label="Phone">
                  <Input name="phone" maxLength={40} />
                </Field>
              </div>
            </>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : `Create ${kind}`}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

