'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';
import { LEAD_STATUSES } from '@/lib/enums';

export function LeadActions({
  leadId,
  status,
  ownerEmail,
  convertedOpportunityId,
  owners,
}: {
  leadId: string;
  status: string;
  ownerEmail: string | null;
  convertedOpportunityId: string | null;
  /** Every address this dropdown may show, the lead's current owner included. Built by
   *  the page from the roster AND the owners the CRM actually assigned — see below. */
  owners: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  async function patch(json: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/leads/${leadId}`, { method: 'PATCH', json });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function convert(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const raw = new FormData(e.currentTarget).get('value') as string;
    try {
      const result = await api<{ opportunityId: string }>(`/api/leads/${leadId}/convert`, {
        method: 'POST',
        json: { value: Number(raw) || 0 },
      });
      router.push(`/pipeline/${result.opportunityId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const closed = status === 'converted' || status === 'lost';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}

      {/* Options come from the page, not from the workspace roster alone. Built from the
          roster the dropdown offered only the two people with accounts here, so for
          essentially all 27,256 CRM-owned leads the current owner was not among them —
          and a select whose value matches no option renders the first one. This read
          "Unassigned" beside a Details panel naming the real owner. */}
      <Select
        aria-label="Owner"
        className="w-auto"
        disabled={busy}
        value={ownerEmail ?? ''}
        onChange={(e) => patch({ ownerEmail: e.target.value || null })}
      >
        <option value="">Unassigned</option>
        {owners.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Status"
        className="w-auto"
        disabled={busy}
        value={status}
        onChange={(e) => patch({ status: e.target.value })}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replaceAll('_', ' ')}
          </option>
        ))}
      </Select>

      {convertedOpportunityId ? (
        <Button variant="outline" size="sm" onClick={() => router.push(`/pipeline/${convertedOpportunityId}`)}>
          View deal
        </Button>
      ) : (
        <Button size="sm" disabled={busy || closed} onClick={() => setConverting(true)}>
          Convert to deal
        </Button>
      )}

      <Modal
        open={converting}
        onClose={() => setConverting(false)}
        title="Convert to opportunity"
        description="Carries the company, contact and campaign across so attribution survives."
      >
        <form onSubmit={convert} className="space-y-3">
          <Field label="Deal value (USD)">
            <Input name="value" type="number" min="0" step="100" defaultValue="0" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConverting(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Converting…' : 'Create deal'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
