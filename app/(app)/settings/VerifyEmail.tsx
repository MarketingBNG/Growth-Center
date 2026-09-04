'use client';

import { useState, useTransition } from 'react';
import { api } from '@/lib/fetcher';

/**
 * Checks that the mail server accepts the credentials, without sending anything.
 *
 * The settings row above it says whether SMTP is configured, which is a different claim:
 * a wrong password, a blocked port and a suspended mailbox all read as "configured" and
 * all produce the same symptom — a digest that never arrives, noticed days later by
 * somebody wondering why the queue went quiet.
 */
export function VerifyEmail({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [pending, start] = useTransition();

  if (!configured) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Set <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> to
        send. Zoho Mail uses <code>smtp.zoho.in</code> on port 465.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setResult(await api<{ ok: boolean; detail: string }>('/api/settings/email', { method: 'POST' }));
            } catch (e) {
              setResult({ ok: false, detail: e instanceof Error ? e.message : 'Could not check.' });
            }
          })
        }
        className="h-7 rounded border px-2.5 text-[11px] disabled:opacity-50"
      >
        {pending ? 'Checking…' : 'Check the connection'}
      </button>
      {result ? (
        <span className={`text-[11px] ${result.ok ? 'text-success-strong' : 'text-destructive'}`}>
          {result.detail}
        </span>
      ) : null}
    </div>
  );
}
