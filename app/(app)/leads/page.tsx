import { Suspense } from 'react';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { SortHeader } from '@/components/patterns/sort-header';
import { LeadStatusBadge, SourceBadge } from '@/components/patterns/badges';
import { SourceBadge as ProvenanceBadge } from '@/components/patterns/source-badge';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { ProgressLink } from '@/components/NavProgress';
import { leadsBand } from '@/lib/band';
import { bucketFor, customRange, rangeParam } from '@/lib/range';
import { rangeFor } from '@/lib/metrics';
import { pageQuery, pick } from '@/lib/query';
import { leadCampaignOptions, leadFilters, leadSourceOptions, listLeads } from '@/lib/leads';
import { leadCampaign, leadSourceLabel } from '@/lib/integrations/crm-mapping';
import { LEAD_STATUSES } from '@/lib/enums';
import { DEMO_SOURCE } from '@/lib/sources';
import { listAssignable, peopleOn, personOptions, type AppUser } from '@/lib/users';
import { fmtRelative } from '@/lib/format';
import { NewLeadButton } from './NewLeadButton';
import { RebalanceButton } from './RebalanceButton';

export const metadata = { title: 'Leads · Growth Center' };

const filtersFor = (
  people: AppUser[],
  owners: string[],
  sources: { value: string; label: string }[],
  campaigns: { value: string; label: string }[],
) => [
  // Underscores stripped, as the Source filter beside it already did — the Status
  // dropdown was the one control on the page reading "semi_qualified".
  {
    name: 'status',
    label: 'Status',
    options: LEAD_STATUSES.map((s) => ({ value: s, label: s.replaceAll('_', ' ') })),
  },
  // Zoho's own vocabulary, not the SourceType enum this used to offer. That enum has no
  // word for the distinctions the CRM makes and the team works to — every Instagram,
  // Facebook, LinkedIn and WhatsApp lead was one option called "social", 17,989 of them,
  // and Canada, Incorp and Landing Page could not be asked for at all.
  { name: 'leadSource', label: 'Source', options: sources },
  // The business line the CRM's source string names. Not the `campaignId` relation —
  // Zoho stamps no campaign on a lead and every UTM column is empty, so that column is
  // null on all 27,401 of them. This is the only campaign the data actually contains.
  { name: 'leadCampaign', label: 'Campaign', options: campaigns },
  {
    name: 'ownerEmail',
    label: 'Owner',
    // The roster AND whoever the CRM actually assigned. Most leads here are owned by
    // people with no account in this app, and offering only the roster made the busiest
    // owners unselectable.
    options: [
      { value: 'unassigned', label: 'Unassigned' },
      ...personOptions(people, owners),
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

  const q = pageQuery(params);
  const { value, days, bucket: presetBucket } = rangeParam(params);
  const filters = leadFilters.parse(pick(params, ['status', 'sourceType', 'leadSource', 'leadCampaign', 'ownerEmail', 'campaignId', 'channelId', 'from', 'to']));
  // The window the picker resolved, handed to the list as well as the band so the table
  // and the cards above it describe the same period. A hand-picked ?from=&to= wins, which
  // is what the CRM page's owner links carry.
  const picked = customRange(params);
  const window = picked ?? rangeFor(days).current;
  const bucket = picked ? bucketFor(picked.days) : presetBucket;

  // Nothing is awaited before the header goes out. Leads reads live data on every view —
  // a stale lead list would be a bug, not an invisible delay, so it cannot be cached the
  // way the metrics pages are — and it cannot take a `loading.tsx` either, because a
  // loading boundary on this segment would flush a 200 over the 404s that `leads/[id]`
  // raises for a lead that does not exist.
  //
  // Streaming inside the page is the way to have both: the boundary lives here rather
  // than on the segment, so the detail route keeps its status code while the title, range
  // picker and New Lead button paint immediately and the slow reads fill in behind them.
  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every hand-raise, with the source that produced it."
        actions={
          <>
            <RangePicker current={value} />
            <RebalanceButton />
            <NewLeadButton />
          </>
        }
      />

      <Suspense fallback={<BandSkeleton />}>
        {/* Arriving from a CRM owner link carries ?from=&to=; the band has to honour it,
            or the cards describe the last thirty days over a table that does not. */}
        <Band spec={picked ?? days} bucket={bucket} />
      </Suspense>

      <Suspense fallback={<Skeleton className="mb-[18px] h-[38px] w-full rounded-xl" />}>
        <Filters />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] rounded-2xl" />}>
        <LeadsTable filters={filters} q={q} window={window} />
      </Suspense>
    </>
  );
}

function BandSkeleton() {
  return (
    <div className="grid gap-3.5 pb-[18px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-2xl" />
      ))}
    </div>
  );
}

async function Band({ spec, bucket }: { spec: number | ReturnType<typeof customRange>; bucket: 'day' | 'month' }) {
  return <MetricsBand {...(await leadsBand(spec as Parameters<typeof leadsBand>[0], bucket))} />;
}

/** Its own boundary: the roster and the owner list are two more queries, and the filter
 *  bar does not need to hold up the table behind it. */
async function Filters() {
  const [people, owners, sources, campaigns] = await Promise.all([
    listAssignable(),
    peopleOn('lead', 'ownerEmail'),
    leadSourceOptions(),
    leadCampaignOptions(),
  ]);
  return (
    <FilterBar
      filters={filtersFor(people, owners, sources, campaigns)}
      searchPlaceholder="Name, email, company or phone…"
    />
  );
}

async function LeadsTable({
  filters,
  q,
  window,
}: {
  filters: Parameters<typeof listLeads>[0];
  q: ReturnType<typeof pageQuery>;
  window: Parameters<typeof listLeads>[2];
}) {
  const { rows, total } = await listLeads(filters, q, window);

  return (
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-6" />}
            title="No leads match this view"
            hint={
              total === 0
                ? 'No leads were created in this period. Widen the range, or clear the filters.'
                : 'Clear the filters to see the rest.'
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    {/* SortHeader renders its own th, so these are not wrapped in TH. */}
                    <SortHeader name="firstName">Name</SortHeader>
                    <SortHeader name="companyName">Company</SortHeader>
                    <SortHeader name="status">Status</SortHeader>
                    {/* Sorted on the CRM's own string, which is what the cell shows
                        under the badge — sorting by the group would put "Canada Meta Ads"
                        and "Meta Ads" in different places for no visible reason. */}
                    <SortHeader name="sourceDetail">Source</SortHeader>
                    {/* Derived from sourceDetail, so there is nothing to sort on that the
                        Source header does not already sort by. */}
                    <TH>Campaign</TH>
                    <SortHeader name="ownerEmail">Owner</SortHeader>
                    <SortHeader name="createdAt" align="right">Created</SortHeader>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((lead) => (
                    <TR key={lead.id}>
                      <TD>
                        <span className="inline-flex items-center gap-1.5">
                          <ProgressLink href={`/leads/${lead.id}`} className="font-medium hover:text-primary">
                            {[lead.firstName, lead.lastName].filter(Boolean).join(' ')}
                          </ProgressLink>
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
                      {/* The source Zoho recorded, grouped for the badge and quoted
                          verbatim beneath it. The badge is the campaign detail's channel;
                          the line under it distinguishes "Trademark Google Ads" from
                          "Incorporation Google Ads", which is the whole reason this column
                          stopped saying "paid ads".
                          
                          There was a Channel column beside this one until the two
                          vocabularies were unified. The badge IS the channel now —
                          `leadSourceGroup` decides both — so the column was the same word
                          printed twice on every row. */}
                      <TD>
                        <SourceBadge source={leadSourceLabel(lead.sourceDetail, lead.sourceType)} />
                        {lead.sourceDetail && lead.sourceDetail !== leadSourceLabel(lead.sourceDetail, lead.sourceType) ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{lead.sourceDetail}</p>
                        ) : null}
                      </TD>
                      {/* The business line the CRM named, and an em-dash where it named
                          none — which is 19,753 leads whose source is "fb" or "ig". A
                          guess here would be a campaign nobody ran. */}
                      <TD className="text-muted-foreground">
                        {leadCampaign(lead.sourceDetail) ?? '—'}
                      </TD>
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
  );
}
