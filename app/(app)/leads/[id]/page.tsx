import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink, Detail, DetailHeader, HistoryCard, LinkedRow, NotesCard } from '@/components/patterns/detail';
import { Badge } from '@/components/ui/badge';
import { LeadStatusBadge, SourceBadge } from '@/components/patterns/badges';
import { leadCampaign, leadSourceLabel } from '@/lib/integrations/crm-mapping';
import { TaskList } from '@/components/patterns/task-list';
import { getLead } from '@/lib/leads/leads';
import { hasDb } from '@/lib/platform/prisma';
import { listAssignable, peopleOn, personOptions } from '@/lib/access/users';
import { fmtDate, fmtMoney } from '@/lib/shared/format';
import { LeadActions } from './LeadActions';

export const metadata = { title: 'Lead · Growth Center' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const lead = await getLead((await params).id);
  const [people, seen] = await Promise.all([listAssignable(), peopleOn('lead', 'ownerEmail')]);
  if (!lead) notFound();

  // The lead's own owner is appended in case it fell outside peopleOn's top 100, so the
  // dropdown can always show who this lead currently belongs to.
  const owners = personOptions(
    people,
    lead.ownerEmail ? [lead.ownerEmail, ...seen] : seen,
  );

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
      <BackLink href="/leads" label="All leads" />

      <DetailHeader
        title={name}
        badge={<LeadStatusBadge status={lead.status} />}
        subtitle={
          <p className="mt-1 text-label text-muted-foreground">
            {[lead.title, lead.companyName].filter(Boolean).join(' · ') || 'No company recorded'}
          </p>
        }
        actions={
          <LeadActions
            leadId={lead.id}
            status={lead.status}
            ownerEmail={lead.ownerEmail}
            convertedOpportunityId={lead.opportunities[0]?.id ?? null}
            owners={owners}
          />
        }
      />

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
              <Detail label="Source" value={<SourceBadge source={leadSourceLabel(lead.sourceDetail, lead.sourceType)} />} />
              {/* The CRM's own two words for this lead, stored on import and shown
                  nowhere until now: `sourceDetail` is where it actually came from ("fb",
                  "Incorporation LinkdIn") and `sourceStatus` is the team's own status
                  wording ("Semi-Qualified Lead"), which the shared seven-value vocabulary
                  beside it cannot express. Set on 27,152 and 27,234 leads respectively. */}
              <Detail label="Lead source" value={lead.sourceDetail} />
              <Detail label="CRM status" value={lead.sourceStatus} />
              {/* No Channel row. `leadSourceGroup` decides both, so Source above printed
                  the same word on 27,294 of 27,401 leads — and on the other 107 it said
                  "Unattributed" or "Other" where Channel could only manage a dash. */}
              {/* The real Campaign relation first, then the business line the CRM's own
                  source string names. The relation is null on all 27,401 leads — Zoho
                  stamps no campaign and every UTM column is empty — so this row was an
                  em-dash on every lead in the workspace. */}
              <Detail
                label="Campaign"
                value={lead.campaign?.name ?? leadCampaign(lead.sourceDetail)}
              />
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
                  <LinkedRow key={o.id} href={`/pipeline/${o.id}`}>
                    <span>{o.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Badge tone="info">{o.stage.name}</Badge>
                      {fmtMoney(Number(o.value), false, o.currency)}
                    </span>
                  </LinkedRow>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <NotesCard parent={{ leadId: lead.id }} notes={lead.noteEntries} />
        </div>

        <div className="space-y-4">
          <TaskList tasks={lead.tasks} />

          <HistoryCard entries={lead.activities} />
        </div>
      </div>
    </>
  );
}
