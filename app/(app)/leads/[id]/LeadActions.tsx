'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';
import { LEAD_STATUSES } from '@/lib/enums';
import { ASSIGNABLE } from '@/lib/roles';

export function LeadActions({
  leadId,
  status,
  ownerEmail,
  convertedOpportunityId,
}: {
  leadId: string;
  status: string;
  ownerEmail: string | null;
  convertedOpportunityId: string | null;
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

      <Select
        aria-label="Owner"
        className="w-auto"
        disabled={busy}
        value={ownerEmail ?? ''}
        onChange={(e) => patch({ ownerEmail: e.target.value || null })}
      >
        <option value="">Unassigned</option>
        {ASSIGNABLE.map((a) => (
          <option key={a.email} value={a.email}>
            {a.name}
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
            {s}
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
          <div className="space-y-1">
            <Label>Deal value (USD)</Label>
            <Input name="value" type="number" min="0" step="100" defaultValue="0" autoFocus />
          </div>
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
