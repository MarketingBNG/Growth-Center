import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { LeadStatusBadge, SourceBadge } from '@/components/patterns/badges';
import { SourceBadge as ProvenanceBadge } from '@/components/patterns/source-badge';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { leadsBand } from '@/lib/band';
import { rangeParam } from '@/lib/range';
import { pageQuery, pick } from '@/lib/query';
import { leadFilters, listLeads } from '@/lib/leads';
import { LEAD_STATUSES, SOURCE_TYPES } from '@/lib/enums';
import { DEMO_SOURCE } from '@/lib/sources';
import { listAssignable, type AppUser } from '@/lib/users';
import { fmtRelative } from '@/lib/format';
import { NewLeadButton } from './NewLeadButton';

export const metadata = { title: 'Leads · Growth Center' };

const filtersFor = (people: AppUser[]) => [
  { name: 'status', label: 'Status', options: LEAD_STATUSES.map((s) => ({ value: s, label: s })) },
  {
    name: 'sourceType',
    label: 'Source',
    options: SOURCE_TYPES.map((s) => ({ value: s, label: s.replaceAll('_', ' ') })),
  },
  {
    name: 'ownerEmail',
    label: 'Owner',
    options: [
      { value: 'unassigned', label: 'Unassigned' },
      ...people.map((a) => ({ value: a.email, label: a.name })),
    ],
  },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Leads" subtitle="Every hand-raise, with the source that produced it." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const people = await listAssignable();
  const q = pageQuery(params);
  const { value, days, bucket } = rangeParam(params);
  const filters = leadFilters.parse(pick(params, ['status', 'sourceType', 'ownerEmail', 'campaignId', 'channelId', 'from', 'to']));
  const [{ rows, total }, band] = await Promise.all([
    listLeads(filters, q),
    leadsBand(days, bucket),
  ]);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every hand-raise, with the source that produced it."
        actions={
          <>
            <RangePicker current={value} />
            <NewLeadButton />
          </>
        }
      />

      <MetricsBand {...band} />

      <FilterBar filters={filtersFor(people)} searchPlaceholder="Name, email or company…" />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-6" />}
            title="No leads match this view"
            hint={
              total === 0
                ? 'Leads arrive from your website forms via the public API, from ad platforms once connected, or by hand.'
                : 'Clear the filters to see the rest.'
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Status</TH>
                    <TH>Source</TH>
                    <TH>Campaign</TH>
                    <TH>Owner</TH>
                    <TH className="text-right">Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((lead) => (
                    <TR key={lead.id}>
                      <TD>
                        <span className="inline-flex items-center gap-1.5">
                          <Link href={`/leads/${lead.id}`} className="font-medium hover:text-primary">
                            {[lead.firstName, lead.lastName].filter(Boolean).join(' ')}
                          </Link>
                          {/* Which system wrote the row, distinct from the `sourceType`
                              column beside it — that says how the lead found us, this
                              says whether the record is real or the seeder's. */}
                          <ProvenanceBadge source={lead.source ?? DEMO_SOURCE} />
                        </span>
                        {lead.email ? (
                          <p className="text-xs text-muted-foreground">{lead.email}</p>
                        ) : null}
                      </TD>
                      <TD className="text-muted-foreground">{lead.companyName ?? '—'}</TD>
                      <TD>
                        <LeadStatusBadge status={lead.status} />
                      </TD>
                      <TD>
                        <SourceBadge source={lead.sourceType} />
                      </TD>
                      <TD className="text-muted-foreground">{lead.campaign?.name ?? '—'}</TD>
                      <TD className="text-muted-foreground">
                        {lead.ownerEmail ? lead.ownerEmail.split('@')[0] : 'Unassigned'}
                      </TD>
                      <TD className="text-right text-muted-foreground">
                        {fmtRelative(lead.createdAt)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <Pager page={q.page} perPage={q.perPage} total={total} />
          </>
        )}
      </Card>
    </>
  );
}
