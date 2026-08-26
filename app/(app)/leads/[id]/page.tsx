import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LeadStatusBadge, PriorityBadge, SourceBadge } from '@/components/patterns/badges';
import { Timeline } from '@/components/patterns/timeline';
import { getLead } from '@/lib/leads';
import { hasDb } from '@/lib/prisma';
import { fmtDate, fmtMoney, fmtRelative } from '@/lib/format';
import { LeadActions } from './LeadActions';
import { NoteBox } from './NoteBox';

export const metadata = { title: 'Lead · Growth Center' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const lead = await getLead((await params).id);
  if (!lead) notFound();

  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  const utms = [
    ['Source', lead.utmSource],
    ['Medium', lead.utmMedium],
    ['Campaign', lead.utmCampaign],
    ['Term', lead.utmTerm],
    ['Content', lead.utmContent],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <>
      <Link
        href="/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{name}</h1>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {[lead.title, lead.companyName].filter(Boolean).join(' · ') || 'No company recorded'}
          </p>
        </div>
        <LeadActions
          leadId={lead.id}
          status={lead.status}
          ownerEmail={lead.ownerEmail}
          convertedOpportunityId={lead.opportunities[0]?.id ?? null}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Email" value={lead.email} />
              <Detail label="Phone" value={lead.phone} />
              <Detail label="Owner" value={lead.ownerEmail ?? 'Unassigned'} />
              <Detail label="Source" value={<SourceBadge source={lead.sourceType} />} />
              <Detail label="Channel" value={lead.channel?.name} />
              <Detail label="Campaign" value={lead.campaign?.name} />
              <Detail label="Created" value={fmtDate(lead.createdAt)} />
              <Detail label="Qualified" value={lead.qualifiedAt ? fmtDate(lead.qualifiedAt) : '—'} />
              {lead.landingPage ? (
                <Detail label="Landing page" value={lead.landingPage} className="sm:col-span-2" />
              ) : null}
              {lead.referrer ? (
                <Detail label="Referrer" value={lead.referrer} className="sm:col-span-2" />
              ) : null}
              {lead.message ? (
                <Detail label="Message" value={lead.message} className="sm:col-span-2" />
              ) : null}
            </CardContent>
          </Card>

          {utms.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Attribution</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {utms.map(([label, value]) => (
                  <Badge key={label} tone="neutral">
                    <span className="text-muted-foreground">{label.toLowerCase()}:</span> {value}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {lead.opportunities.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Opportunities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.opportunities.map((o) => (
                  <Link
                    key={o.id}
                    href={`/pipeline/${o.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span>{o.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Badge tone="info">{o.stage.name}</Badge>
                      {fmtMoney(Number(o.value))}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NoteBox leadId={lead.id} />
              {lead.noteEntries.map((n) => (
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

        <div className="space-y-4">
          {lead.tasks.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Open tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.tasks.map((t) => (
                  <div key={t.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug">{t.title}</p>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t.dueDate ? `Due ${fmtDate(t.dueDate)}` : 'No due date'}
                      {t.assigneeEmail ? ` · ${t.assigneeEmail.split('@')[0]}` : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <Timeline entries={lead.activities} />
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm">{value || '—'}</p>
    </div>
  );
}
