'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';

export function ApiKeys() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    try {
      const result = await api<{ key: string }>('/api/settings/api-keys', {
        method: 'POST',
        json: { name },
      });
      setCreated(result.key);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setCreated(null);
    setCopied(false);
    setError(null);
  }

  return (
    <>
      <div className="px-5 pb-3">
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> New API key</Button>
      </div>

      <Modal
        open={open}
        onClose={close}
        title={created ? 'Copy this key now' : 'New API key'}
        description={
          created
            ? 'This is the only time it will be shown. Only a hash is stored, so it cannot be recovered.'
            : 'Name it after the site or form that will use it.'
        }
      >
        {created ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{created}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(created);
                  setCopied(true);
                }}
              >
                <Copy /> {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-[11px] font-medium">Use it like this</p>
              <pre className="mt-1 overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">{`curl -X POST ${typeof window === 'undefined' ? '' : window.location.origin}/api/public/v1/leads \\
  -H 'content-type: application/json' \\
  -H 'x-api-key: ${created}' \\
  -d '{"firstName":"Alice","email":"alice@acme.com","utmSource":"google"}'`}</pre>
            </div>
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name" required>
              <Input name="name" required autoFocus maxLength={80} placeholder="usaindiacfo.com contact form" />
            </Field>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
