import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Timeline } from '@/components/patterns/timeline';
import { NoteBox } from '../../leads/[id]/NoteBox';
import { db, hasDb } from '@/lib/prisma';
import { convert } from '@/lib/currency';
import { currencySettings } from '@/lib/settings';
import { fmtDate, fmtMoney, fmtRelative } from '@/lib/format';
import { StageMover } from './StageMover';
import { ProgressLink } from '@/components/NavProgress';

export const metadata = { title: 'Deal · Growth Center' };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const { id } = await params;

  const deal = await db().opportunity.findUnique({
    where: { id },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: 'asc' } } } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      campaign: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true, sourceType: true } },
      activities: { orderBy: { createdAt: 'desc' } },
      noteEntries: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!deal) notFound();

  // The board shows every card converted into the reporting currency, because a column
  // cannot sum rupees and dollars. This page shows the deal as billed. Both are right and
  // together they read as a contradiction — the same deal at $150 here and Rs.14,313
  // there — so when the two differ this says what the other number is.
  const fx = await currencySettings();
  // Nothing to reconcile on a deal worth nothing: "$0.00 - Rs.0 reported" is noise, and
  // plenty of these deals carry no amount.
  const reported =
    deal.currency === fx.reporting || Number(deal.value) === 0
      ? null
      : convert(Number(deal.value), deal.currency, fx);

  return (
    <>
      <ProgressLink
        href="/pipeline"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Pipeline
      </ProgressLink>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{deal.name}</h1>
            <Badge tone={deal.stage.isWon ? 'success' : deal.stage.isLost ? 'danger' : 'info'}>
              {deal.stage.name}
            </Badge>
          </div>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {fmtMoney(Number(deal.value), false, deal.currency)} · {deal.probability}% ·{' '}
            {deal.company?.name ?? 'No company'}
          </p>
        </div>
        <StageMover
          dealId={deal.id}
          stageId={deal.stageId}
          stages={deal.pipeline.stages.map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail
                label="Value"
                value={
                  <>
                    {fmtMoney(Number(deal.value), true, deal.currency)}
                    {reported !== null ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {fmtMoney(reported, false, fx.reporting)} reported
                      </span>
                    ) : null}
                  </>
                }
              />
              <Detail label="Probability" value={`${deal.probability}%`} />
              <Detail label="Owner" value={deal.ownerEmail ?? 'Unassigned'} />
              <Detail label="Expected close" value={fmtDate(deal.expectedCloseDate)} />
              {/* "Open" only when the stage says so. Zoho leaves Closing_Date empty on
                  982 of its won deals, so 1,122 of these sit in a won or lost stage with
                  no date — and this row called every one of them open, directly under a
                  badge reading "Project In Progress". */}
              <Detail
                label="Closed"
                value={
                  deal.closedAt
                    ? fmtDate(deal.closedAt)
                    : deal.stage.isWon || deal.stage.isLost
                      ? `${deal.stage.isWon ? 'Won' : 'Lost'}, no date recorded`
                      : 'Open'
                }
              />
              <Detail label="Created" value={fmtDate(deal.createdAt)} />
              <Detail
                label="Company"
                value={
                  deal.company ? (
                    <ProgressLink href={`/crm/companies/${deal.company.id}`} className="hover:text-primary">
                      {deal.company.name}
                    </ProgressLink>
                  ) : null
                }
              />
              <Detail
                label="Contact"
                value={
                  deal.contact ? (
                    <ProgressLink href={`/crm/contacts/${deal.contact.id}`} className="hover:text-primary">
                      {[deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ')}
                    </ProgressLink>
                  ) : null
                }
              />
              <Detail label="Campaign" value={deal.campaign?.name} />
              <Detail
                label="Originating lead"
                value={
                  deal.lead ? (
                    <ProgressLink href={`/leads/${deal.lead.id}`} className="hover:text-primary">
                      {[deal.lead.firstName, deal.lead.lastName].filter(Boolean).join(' ')} (
                      {deal.lead.sourceType.replaceAll('_', ' ')})
                    </ProgressLink>
                  ) : null
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NoteBox opportunityId={deal.id} />
              {deal.noteEntries.map((n) => (
                <div key={n.id} className="rounded-md border border-border px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {n.authorEmail.split('@')[0]} · {fmtRelative(n.createdAt)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <Timeline entries={deal.activities} />
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm">{value || '—'}</p>
    </div>
  );
}
