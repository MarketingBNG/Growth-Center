import { Users } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { RANGE_OPTIONS } from '@/lib/enums';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { DuplicateQueue } from './DuplicateQueue';
import { Lifecycle } from './Lifecycle';
import { duplicateCounts, duplicateQueue } from '@/lib/duplicate-queue';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { SourceBadge } from '@/components/patterns/source-badge';
import { SortHeader } from '@/components/patterns/sort-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { crmBand } from '@/lib/band';
import { ProgressLink } from '@/components/NavProgress';
import { bucketFor, customRange, rangeParam } from '@/lib/range';
import { pageQuery, pick } from '@/lib/query';
import { listCompanies, listContacts, UNASSIGNED } from '@/lib/crm';
import { listAssignable, peopleOn, personOptions, type AppUser } from '@/lib/users';
import { fmtDate, fmtNumber } from '@/lib/format';
import { DEMO_SOURCE } from '@/lib/sources';
import { NewCrmRecordButton } from './NewCrmRecordButton';
import { Overview } from './Overview';
import { crmOverview } from '@/lib/crm-overview';
import { rangeFor } from '@/lib/metrics';

export const metadata = { title: 'CRM · Growth Center' };

/** Owner on both tabs - every row has one - plus, for companies, the customer/prospect
 *  split the Status column already shows. */
const filtersFor = (tab: 'companies' | 'contacts', people: AppUser[], owners: string[]) => [
  {
    name: 'ownerEmail',
    label: 'Owner',
    // The roster AND whoever the CRM assigned, as the leads page does: most owners here
    // have no account in this app and would otherwise be unselectable.
    options: [{ value: UNASSIGNED, label: 'Unassigned' }, ...personOptions(people, owners)],
  },
  ...(tab === 'companies'
    ? [
        {
          name: 'status',
          label: 'Status',
          options: [
            { value: 'customer', label: 'Customer' },
            { value: 'prospect', label: 'Prospect' },
          ],
        },
      ]
    : []),
];


export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // §8.2's client lifecycle is a third tab rather than a panel: it is about the accounts
  // already won, and the two lists beside it are about everyone the firm has ever spoken
  // to. Mixing them on one screen was the manual's complaint about this page.
  const tab =
    params.tab === 'contacts' ? 'contacts' : params.tab === 'lifecycle' ? 'lifecycle' : 'companies';

  if (!hasDb()) {
    return (
      <>
        <PageHeader title="CRM" subtitle="Contacts and companies." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  // Switching tab keeps the rest of the URL. These were plain links to /crm and
  // /crm?tab=contacts, so moving between Companies and Contacts silently discarded the
  // search term and the date range — you would filter a view, switch tab to check
  // something, and come back to an unfiltered page with the box empty.
  //
  // `page` is the one thing deliberately dropped: the tabs hold different numbers of
  // records, and arriving on page 5 of a shorter list shows nothing at all.
  const tabHref = (next: 'companies' | 'contacts' | 'lifecycle') => {
    const carried = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'tab' || k === 'page') continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value) carried.set(k, value);
    }
    if (next !== 'companies') carried.set('tab', next);
    const query = carried.toString();
    return query ? `/crm?${query}` : '/crm';
  };

  const q = pageQuery(params);
  const { value, days, bucket: presetBucket } = rangeParam(params);

  // A hand-picked window wins over the preset when both are in the URL; the picker clears
  // the other, so having both means someone edited the link.
  const picked = customRange(params);
  const window = picked ?? rangeFor(days).current;
  // The preset's own label rather than `Last ${days} days`, which read "Last 180 days"
  // for the six-month window and "Last 365 days" for the year.
  const rangeLabel = picked
    ? picked.label
    : value === 'today'
      ? 'Last 1 day'
      : (RANGE_OPTIONS.find((o) => o.value === value)?.label ?? `Last ${days} days`);
  // The chart buckets by the window actually being drawn, not by the preset behind it.
  const bucket = picked ? bucketFor(picked.days) : presetBucket;

  const { ownerEmail, status } = pick<{ ownerEmail?: string; status?: string }>(params, [
    'ownerEmail',
    'status',
  ]);
  const owner = ownerEmail || undefined;
  const filtered = Boolean(q.q || ownerEmail || status);

  const [user, people, owners, data, band, overview, dupRows, dupCounts] = await Promise.all([
    currentUser(),
    listAssignable(),
    peopleOn(tab === 'companies' ? 'company' : 'contact', 'ownerEmail'),
    tab === 'lifecycle'
      ? Promise.resolve({ rows: [], total: 0 })
      : tab === 'companies'
      ? listCompanies(q, {
          ownerEmail: owner,
          status: status === 'customer' || status === 'prospect' ? status : undefined,
        })
      : listContacts(q, { ownerEmail: owner }),
    // The picked window, not the preset day count: the cards and the chart now describe
    // the same period as the panel and the label above them.
    crmBand(picked ?? days, bucket),
    crmOverview(window),
    // §8.1. Capped at twenty on the page: a queue nobody can finish is a queue nobody
    // starts, and the strongest twenty are the ones worth a morning.
    duplicateQueue(20),
    duplicateCounts(window),
  ]);

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Contacts and companies, populated automatically by inbound leads."
        actions={
          <>
            <DateRangePicker
              range={value}
              from={typeof params.from === 'string' ? params.from : undefined}
              to={typeof params.to === 'string' ? params.to : undefined}
              label={rangeLabel}
            />
            <NewCrmRecordButton kind={tab === 'companies' ? 'company' : 'contact'} />
          </>
        }
      />

      {/* The band goes first, as it does on every other module screen. The lead-flow
          panels were inserted above it, which pushed the CRM's own five numbers — the
          ones this page is named for — below a seventeen-row table, where you had to
          scroll past everything to reach them. */}
      <MetricsBand {...band} />

      <Overview data={overview} rangeLabel={rangeLabel} window={window} />

      {/* §8.1 and G5.3, above the book rather than below it. The "Duplicates merged"
          card in the band read 0 for months because nothing was scanning, and a queue
          under a seventeen-row table would have been just as invisible. */}
      <DuplicateQueue
        rows={dupRows}
        counts={dupCounts}
        canManage={user ? can(user.role, 'crm:write') : false}
      />

      <div className="flex flex-wrap items-center gap-1 pb-4">
        <Button asChild variant={tab === 'companies' ? 'secondary' : 'ghost'} size="sm">
          <ProgressLink href={tabHref('companies')}>Companies</ProgressLink>
        </Button>
        <Button asChild variant={tab === 'contacts' ? 'secondary' : 'ghost'} size="sm">
          <ProgressLink href={tabHref('contacts')}>Contacts</ProgressLink>
        </Button>
        <Button asChild variant={tab === 'lifecycle' ? 'secondary' : 'ghost'} size="sm">
          <ProgressLink href={tabHref('lifecycle')}>Client lifecycle</ProgressLink>
        </Button>
        {/* The date range drives the panels above and nothing below. Windowing the book
            as well would leave 88 of 2,953 companies on screen and make the one place
            you can look a client up useless for looking anyone up. That is the right
            behaviour, but the picker gave no hint of it — so the list says so itself.

            The lifecycle tab is a snapshot of who is a client now, not of a period, so
            the note would be misleading there and is left off. */}
        {tab === 'lifecycle' ? null : (
          <p className="ml-auto text-xs text-muted-foreground">
            {filtered ? `${fmtNumber(data.total)} matching` : `All ${fmtNumber(data.total)} ${tab}`} ·
            the date range applies to the panels above
          </p>
        )}
      </div>

      {tab === 'lifecycle' ? (
        <Lifecycle canManage={user ? can(user.role, 'crm:write') : false} />
      ) : (
        <>
      {/* Both lists were unfilterable, though every row carries an owner and the leads
          table beside them has had these dropdowns all along. */}
      <FilterBar
        filters={filtersFor(tab, people, owners)}
        searchPlaceholder={tab === 'companies' ? 'Company or phone…' : 'Name, email or phone…'}
      />

      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            // A search that matches nothing is not an empty book. The old copy told
            // someone who had just typed a name that no records existed at all.
            title={filtered ? `No ${tab} match this view` : `No ${tab} yet`}
            hint={
              filtered
                ? 'Clear the search or the filters to see the rest.'
                : 'Records appear here automatically when a lead arrives with a company email, or add one by hand.'
            }
          />
        ) : (
          <>
            <TableWrap>
              {tab === 'companies' ? (
                <CompanyTable rows={data.rows as CompanyRow[]} />
              ) : (
                <ContactTable rows={data.rows as ContactRow[]} />
              )}
            </TableWrap>
            <Pager page={q.page} perPage={q.perPage} total={data.total} />
          </>
        )}
      </Card>
        </>
      )}
    </>
  );
}

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  country: string | null;
  ownerEmail: string | null;
  source: string | null;
  createdAt: Date;
  _count: { contacts: number; opportunities: number };
  customer: { wonAt: Date } | null;
};

function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          {/* SortHeader renders its own th; only the columns lib/crm.ts allows are
              clickable, so a header cannot ask for an order the query will ignore. */}
          <SortHeader name="name">Company</SortHeader>
          {/* Phone, not Industry. Zoho carries no Industry on any of the 2,953 accounts,
              so the column was a full-height run of em dashes; the phone number is on
              seven accounts in eight and is what anyone reading this row wants next. */}
          <TH>Phone</TH>
          <TH className="text-right">Contacts</TH>
          <TH className="text-right">Deals</TH>
          <TH>Status</TH>
          <TH>Owner</TH>
          <SortHeader name="createdAt" align="right">Added</SortHeader>
        </TR>
      </THead>
      <TBody>
        {rows.map((c) => (
          <TR key={c.id}>
            <TD>
              <span className="inline-flex items-center gap-1.5">
                <ProgressLink href={`/crm/companies/${c.id}`} className="font-medium hover:text-primary">
                  {c.name}
                </ProgressLink>
                <SourceBadge source={c.source ?? DEMO_SOURCE} />
              </span>
              {c.domain ? <p className="text-xs text-muted-foreground">{c.domain}</p> : null}
            </TD>
            <TD className="text-muted-foreground">{c.phone ?? '—'}</TD>
            <TD className="text-right tnum">{c._count.contacts}</TD>
            <TD className="text-right tnum">{c._count.opportunities}</TD>
            <TD>
              {c.customer ? (
                <Badge tone="success">customer since {fmtDate(c.customer.wonAt)}</Badge>
              ) : (
                <Badge tone="neutral">prospect</Badge>
              )}
            </TD>
            <TD className="text-muted-foreground">
              {c.ownerEmail ? c.ownerEmail.split('@')[0] : '—'}
            </TD>
            <TD className="text-right text-muted-foreground tnum">{fmtDate(c.createdAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ownerEmail: string | null;
  source: string | null;
  createdAt: Date;
  company: { id: string; name: string } | null;
};

function ContactTable({ rows }: { rows: ContactRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <SortHeader name="firstName">Name</SortHeader>
          <TH>Company</TH>
          <TH>Email</TH>
          <TH>Owner</TH>
          <SortHeader name="createdAt" align="right">Added</SortHeader>
        </TR>
      </THead>
      <TBody>
        {rows.map((c) => (
          <TR key={c.id}>
            <TD>
              <span className="inline-flex items-center gap-1.5">
                <ProgressLink href={`/crm/contacts/${c.id}`} className="font-medium hover:text-primary">
                  {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                </ProgressLink>
                <SourceBadge source={c.source ?? DEMO_SOURCE} />
              </span>
            </TD>
            <TD>
              {c.company ? (
                <ProgressLink
                  href={`/crm/companies/${c.company.id}`}
                  className="text-muted-foreground hover:text-primary"
                >
                  {c.company.name}
                </ProgressLink>
              ) : (
                '—'
              )}
            </TD>
            {/* Truncated, not wrapped: the Zoho-generated addresses run to sixty
                characters and shoved the Added column off the right edge of the card. */}
            <TD className="max-w-[280px] truncate text-muted-foreground" title={c.email ?? undefined}>
              {c.email ?? '—'}
            </TD>
            <TD className="text-muted-foreground">
              {c.ownerEmail ? c.ownerEmail.split('@')[0] : '—'}
            </TD>
            <TD className="text-right text-muted-foreground tnum">{fmtDate(c.createdAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
