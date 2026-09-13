'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { useMutation } from '@/lib/use-mutation';
import { ErrorText } from '@/components/patterns/state';

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
  const [value, setValue] = useState(isDefault ? '' : owner);
  const { pending, error, run } = useMutation();

  function commit() {
    const next = value.trim();
    // Unchanged, so nothing is written — otherwise tabbing through the page would file an
    // audit row per term saying an owner went from Akshay to Akshay.
    if (next === (isDefault ? '' : owner)) return;

    run(
      async () => {
        await api('/api/settings/glossary', {
          method: 'PUT',
          json: { slug, owner: next || null },
        });
      },
      () => setValue(isDefault ? '' : owner),
    );
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
        <ErrorText error={error} as="span" size="meta" />
      ) : isDefault ? (
        <span className="text-meta text-muted-foreground/70">from the manual</span>
      ) : null}
    </div>
  );
}
