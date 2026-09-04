'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';

/**
 * The owner of one definition.
 *
 * Free text, not a picker over the accounts. Appendix C's owners are Akshay, Shweta,
 * Sales, Growth Reviewer and "Metrics layer" — two roles and a layer of this codebase
 * among them — and a picker would force every one of those to be misrepresented as a
 * mailbox. See the note on `parseOwner`.
 *
 * Saves on blur, and an empty field clears the override rather than storing a blank, so
 * the default takes over again and "nobody has chosen" has one representation.
 */
export function GlossaryOwner({
  slug,
  owner,
  isDefault,
}: {
  slug: string;
  owner: string;
  isDefault: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(isDefault ? '' : owner);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function commit() {
    const next = value.trim();
    // Unchanged, so nothing is written — otherwise tabbing through the page would file an
    // audit row per term saying an owner went from Akshay to Akshay.
    if (next === (isDefault ? '' : owner)) return;

    setError(null);
    start(async () => {
      try {
        await api('/api/settings/glossary', {
          method: 'PUT',
          json: { slug, owner: next || null },
        });
        router.refresh();
      } catch (e) {
        setValue(isDefault ? '' : owner);
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Input
        aria-label={`Owner of this definition`}
        value={value}
        placeholder={owner}
        disabled={pending}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        className="h-7 w-40 text-xs"
      />
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : isDefault ? (
        <span className="text-[11px] text-muted-foreground/70">from the manual</span>
      ) : null}
    </div>
  );
}
