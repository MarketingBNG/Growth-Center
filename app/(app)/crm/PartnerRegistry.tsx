'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/state';
import { api } from '@/lib/fetcher';
import { fmtNumber, fmtRelative } from '@/lib/format';
// From referral-types, not referrals: the latter imports lib/prisma, and a value read
// from there pulls the `pg` driver into the browser bundle.
import { PARTNER_TYPES, PARTNER_TYPE_LABELS, SILENT_DAYS, type PartnerRow } from '@/lib/referral-types';

// §8.5's registry. "What is not recorded is not followed up."
//
// The two columns that carry the argument are "Silent for" and "Unacknowledged". A partner
// who sent three clients and was never thanked is the specific failure this exists to make
// visible, and it is invisible in every other system the firm has.

export function PartnerRegistry({ partners, canManage }: { partners: PartnerRow[]; canManage: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', partnerType: 'ca_firm', company: '', email: '' });

  async function save() {
    setBusy('new');
    setError(null);
    try {
      await api('/api/referrals', { method: 'POST', json: form });
      setForm({ name: '', partnerType: 'ca_firm', company: '', email: '' });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function record(id: string, event: 'touch' | 'acknowledgement') {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/referrals/${id}`, { method: 'POST', json: { event } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const silent = partners.filter((p) => p.silent).length;
  const owed = partners.filter((p) => p.unacknowledged > 0).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Referral partners</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            §8.5. The referral channel carries 217 leads and the person who sent each one is
            recorded, where it is recorded at all, as free text in a source string — &ldquo;Ref by
            NG&rdquo;. That cannot be counted, thanked, or asked again.
            {partners.length > 0
              ? ` ${silent} silent beyond ${SILENT_DAYS} days, ${owed} owed a thank-you.`
              : ''}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
            <Plus className="size-3.5" />
            Add partner
          </Button>
        ) : null}
      </CardHeader>

      {error ? (
        <div className="mx-4 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {adding ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Name</span>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-48 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Type</span>
            <select
              value={form.partnerType}
              onChange={(e) => setForm({ ...form, partnerType: e.target.value })}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              {PARTNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PARTNER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Firm</span>
            <input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-52 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <Button size="sm" disabled={!form.name.trim() || busy !== null} onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {partners.length === 0 ? (
        <EmptyState
          icon={<Handshake className="size-6" />}
          title="No partners recorded"
          hint="Referral is the firm’s highest-trust channel. Adding the people who send work is what makes it followable."
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[760px]">
            <THead>
              <TR>
                <TH>Partner</TH>
                <TH>Type</TH>
                <TH className="text-right">Leads sent</TH>
                <TH className="text-right">Clients won</TH>
                <TH className="text-right">Silent for</TH>
                <TH className="text-right">Unacknowledged</TH>
                {canManage ? <TH /> : null}
              </TR>
            </THead>
            <TBody>
              {partners.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <span className={p.active ? 'font-medium' : 'font-medium text-muted-foreground'}>
                      {p.name}
                    </span>
                    {p.company ? <p className="text-xs text-muted-foreground">{p.company}</p> : null}
                  </TD>
                  <TD className="text-muted-foreground">{p.typeLabel}</TD>
                  <TD className="text-right tnum">{fmtNumber(p.leadsReferred)}</TD>
                  <TD className="text-right tnum">{fmtNumber(p.customersWon)}</TD>
                  <TD className={`text-right tnum ${p.silent ? 'text-warning-strong' : 'text-muted-foreground'}`}>
                    {p.lastTouchAt ? fmtRelative(p.lastTouchAt) : `${p.daysSinceTouch}d — never rung`}
                  </TD>
                  {/* A referral that arrived after the last thank-you is a debt. This is
                      the column the registry exists for. */}
                  <TD className={`text-right tnum ${p.unacknowledged > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {p.unacknowledged === 0 ? '—' : fmtNumber(p.unacknowledged)}
                  </TD>
                  {canManage ? (
                    <TD className="text-right">
                      <span className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => record(p.id, 'touch')}
                        >
                          Spoke to
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => record(p.id, 'acknowledgement')}
                        >
                          Thanked
                        </Button>
                      </span>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
