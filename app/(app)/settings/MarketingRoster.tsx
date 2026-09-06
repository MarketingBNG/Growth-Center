'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/fetcher';

/**
 * Who the Growth Center's queue is for.
 *
 * D2: the task-debt rule raised one finding per person across the whole firm — eighteen
 * of them, one on the marketing team — and a queue that cannot be worked is abandoned
 * inside a fortnight.
 *
 * The whole list saves at once, unlike the thresholds card beside it. A threshold is one
 * decision per row; a roster is one decision about a team, and adding two people while
 * removing a third is a single thought that should be a single audit row.
 */
export function MarketingRoster({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    emails.length !== initial.length || emails.some((e, i) => e !== initial[i]);

  function add() {
    // A pasted list is the likely input — somebody copies eight addresses out of an email
    // — so anything that separates them separates them.
    const parts = draft.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setEmails((current) => [...new Set([...current, ...parts])]);
    setDraft('');
    setNote(null);
  }

  function save() {
    setError(null);
    setNote(null);
    start(async () => {
      try {
        const out = await api<{ emails: string[]; rejected: string[] }>('/api/settings/roster', {
          method: 'PUT',
          json: { emails },
        });
        setEmails(out.emails);
        // Said rather than swallowed: an address outside the firm's domains belongs to
        // somebody who cannot sign in, and a name quietly vanishing from a list the
        // person just saved looks like the save failed.
        setNote(
          out.rejected.length > 0
            ? `Saved. Not added, outside the firm’s domains: ${out.rejected.join(', ')}`
            : 'Saved.',
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div className="space-y-3">
      {emails.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody added yet, so the task queue counts the whole firm and says so.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <li
              key={email}
              className="flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 text-[11px]"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setEmails((c) => c.filter((e) => e !== email))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="name@usaindiacfo.com — paste several if you like"
          className="h-8 max-w-xs text-xs"
        />
        <Button size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save roster'}
        </Button>
      </div>

      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
