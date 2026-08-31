import Link from 'next/link';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
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
import { bucketFor, customRange, rangeParam } from '@/lib/range';
import { pageQuery } from '@/lib/query';
import { listCompanies, listContacts } from '@/lib/crm';
import { fmtDate, fmtNumber } from '@/lib/format';
import { DEMO_SOURCE } from '@/lib/sources';
import { NewCrmRecordButton } from './NewCrmRecordButton';
import { Overview } from './Overview';
import { crmOverview } from '@/lib/crm-overview';
import { rangeFor } from '@/lib/metrics';

export const metadata = { title: 'CRM · Growth Center' };

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = params.tab === 'contacts' ? 'contacts' : 'companies';

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
  const tabHref = (next: 'companies' | 'contacts') => {
    const carried = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'tab' || k === 'page') continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value) carried.set(k, value);
    }
    if (next === 'contacts') carried.set('tab', 'contacts');
    const query = carried.toString();
    return query ? `/crm?${query}` : '/crm';
  };

  const q = pageQuery(params);
  const { value, days, bucket: presetBucket } = rangeParam(params);

  // A hand-picked window wins over the preset when both are in the URL; the picker clears
  // the other, so having both means someone edited the link.
  const picked = customRange(params);
  const window = picked ?? rangeFor(days).current;
  const rangeLabel = picked
    ? picked.label
    : value === 'today'
      ? 'Today'
      : `Last ${days} days`;
  // The chart buckets by the window actually being drawn, not by the preset behind it.
  const bucket = picked ? bucketFor(picked.days) : presetBucket;

  const [data, band, overview] = await Promise.all([
    tab === 'companies' ? listCompanies(q) : listContacts(q),
    // The picked window, not the preset day count: the cards and the chart now describe
    // the same period as the panel and the label above them.
    crmBand(picked ?? days, bucket),
    crmOverview(window),
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

      <Overview data={overview} rangeLabel={rangeLabel} window={window} />

      <MetricsBand {...band} />

      <div className="flex flex-wrap items-center gap-1 pb-4">
        <Button asChild variant={tab === 'companies' ? 'secondary' : 'ghost'} size="sm">
          <Link href={tabHref('companies')}>Companies</Link>
        </Button>
        <Button asChild variant={tab === 'contacts' ? 'secondary' : 'ghost'} size="sm">
          <Link href={tabHref('contacts')}>Contacts</Link>
        </Button>
        {/* The date range drives the panels above and nothing below. Windowing the book
            as well would leave 88 of 2,953 companies on screen and make the one place
            you can look a client up useless for looking anyone up. That is the right
            behaviour, but the picker gave no hint of it — so the list says so itself. */}
        <p className="ml-auto text-xs text-muted-foreground">
          {q.q ? `${fmtNumber(data.total)} matching` : `All ${fmtNumber(data.total)} ${tab}`} · the
          date range applies to the panels above
        </p>
      </div>

      <FilterBar
        filters={[]}
        searchPlaceholder={tab === 'companies' ? 'Company or phone…' : 'Name, email or phone…'}
      />

      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={`No ${tab} yet`}
            hint="Records appear here automatically when a lead arrives with a company email, or add one by hand."
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
                <Link href={`/crm/companies/${c.id}`} className="font-medium hover:text-primary">
                  {c.name}
                </Link>
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
                <Link href={`/crm/contacts/${c.id}`} className="font-medium hover:text-primary">
                  {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                </Link>
                <SourceBadge source={c.source ?? DEMO_SOURCE} />
              </span>
            </TD>
            <TD>
              {c.company ? (
                <Link
                  href={`/crm/companies/${c.company.id}`}
                  className="text-muted-foreground hover:text-primary"
                >
                  {c.company.name}
                </Link>
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
