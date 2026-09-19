'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/shared/use-api-action';
import { JURISDICTIONS, JURISDICTION_LABELS } from '@/lib/content/facts-fields';

/**
 * Entering a fact.
 *
 * The form asks for the quoted passage as well as the URL, and the route refuses without
 * it. That is the one field people will want to skip and the one the register exists for:
 * a citation nobody else can check is the situation this replaces, and "I'll add the quote
 * before review" survives a queue remarkably well.
 *
 * A new fact is always a draft. It reaches a reviewer only when somebody sends it, so a
 * half-finished entry does not land in the queue.
 */
export function NewFactButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, run, setError } = useBooleanApiAction();

  function close() {
    setOpen(false);
    setError(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const raw = Object.fromEntries(form) as Record<string, string>;

    await run(async () => {
      const res = await fetch('/api/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: raw.key,
          label: raw.label,
          value: raw.value,
          // Sent only when it is genuinely a number. An empty box must not become 0 — a
          // threshold of zero is a claim, and a wrong one.
          numericValue: raw.numericValue ? Number(raw.numericValue) : null,
          unit: raw.unit || null,
          jurisdiction: raw.jurisdiction,
          authority: raw.authority || null,
          sourceUrl: raw.sourceUrl,
          sourceExcerpt: raw.sourceExcerpt,
          effectiveFrom: raw.effectiveFrom || null,
          effectiveTo: raw.effectiveTo || null,
        }),
      });
      const text = await res.text();
      const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      if (!res.ok) throw new Error((parsed.error as string) || `Failed (${res.status})`);
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="action" onClick={() => setOpen(true)}>
        <Plus /> New fact
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Enter a fact"
        description="A threshold, rate, deadline or form rule. It is saved as a draft and cannot be cited until a reviewer clears it."
      >
        <form onSubmit={submit} className="space-y-3">
          <Field label="Key" required hint="Upper case with dashes. This is what authors type: {{fact:US-FBAR-THRESHOLD}}">
            <Input name="key" required placeholder="US-FBAR-THRESHOLD" />
          </Field>

          <Field label="Label" required hint="How a reviewer will recognise it.">
            <Input name="label" required placeholder="FBAR filing threshold" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Value" required hint="Exactly as it should read in an article.">
              <Input name="value" required placeholder="$10,000" />
            </Field>
            <Field label="As a number" hint="Optional. Leave blank if the fact is not a figure.">
              <Input name="numericValue" type="number" step="any" placeholder="10000" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jurisdiction" required>
              <select
                name="jurisdiction"
                required
                defaultValue="US-FED"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {JURISDICTION_LABELS[j]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Authority" hint="The statute, regulation or form.">
              <Input name="authority" placeholder="31 CFR 1010.350" />
            </Field>
          </div>

          <Field label="Source URL" required>
            <Input name="sourceUrl" type="url" required placeholder="https://www.irs.gov/..." />
          </Field>

          <Field
            label="Quoted passage"
            required
            hint="The sentence that says it, copied from the source. Not a summary — a reviewer has to be able to check this without leaving the page."
          >
            <textarea
              name="sourceExcerpt"
              required
              rows={3}
              minLength={20}
              className="w-full rounded-md border border-border bg-background p-2 text-xs"
              placeholder="A United States person must file an FBAR if the aggregate value of foreign financial accounts exceeded $10,000 at any time during the calendar year."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Effective from">
              <Input name="effectiveFrom" type="date" />
            </Field>
            <Field label="Effective to" hint="Tax facts expire. An end date is what lets an old article be re-checked.">
              <Input name="effectiveTo" type="date" />
            </Field>
          </div>

          <ErrorText error={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save as draft'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
