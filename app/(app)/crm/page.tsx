import Link from 'next/link';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { FilterBar } from '@/components/patterns/filter-bar';
import { Pager } from '@/components/patterns/pager';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { SourceBadge } from '@/components/patterns/source-badge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { crmBand } from '@/lib/band';
import { rangeParam } from '@/lib/range';
import { pageQuery } from '@/lib/query';
import { listCompanies, listContacts } from '@/lib/crm';
import { fmtDate } from '@/lib/format';
import { DEMO_SOURCE } from '@/lib/sources';
import { NewCrmRecordButton } from './NewCrmRecordButton';

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

  const q = pageQuery(params);
  const { value, days, bucket } = rangeParam(params);
  const [data, band] = await Promise.all([
    tab === 'companies' ? listCompanies(q) : listContacts(q),
    crmBand(days, bucket),
  ]);

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Contacts and companies, populated automatically by inbound leads."
        actions={
          <>
            <RangePicker current={value} />
            <NewCrmRecordButton kind={tab === 'companies' ? 'company' : 'contact'} />
          </>
        }
      />

      <MetricsBand {...band} />

      <div className="flex items-center gap-1 pb-4">
        <Button asChild variant={tab === 'companies' ? 'secondary' : 'ghost'} size="sm">
          <Link href="/crm">Companies</Link>
        </Button>
        <Button asChild variant={tab === 'contacts' ? 'secondary' : 'ghost'} size="sm">
          <Link href="/crm?tab=contacts">Contacts</Link>
        </Button>
      </div>

      <FilterBar
        filters={[]}
        searchPlaceholder={tab === 'companies' ? 'Company or domain…' : 'Name, email or title…'}
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
  industry: string | null;
  country: string | null;
  ownerEmail: string | null;
  source: string | null;
  _count: { contacts: number; opportunities: number };
  customer: { wonAt: Date } | null;
};

function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Company</TH>
          <TH>Industry</TH>
          <TH className="text-right">Contacts</TH>
          <TH className="text-right">Deals</TH>
          <TH>Status</TH>
          <TH>Owner</TH>
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
            <TD className="text-muted-foreground">{c.industry ?? '—'}</TD>
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
  title: string | null;
  phone: string | null;
  ownerEmail: string | null;
  source: string | null;
  company: { id: string; name: string } | null;
};

function ContactTable({ rows }: { rows: ContactRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>Title</TH>
          <TH>Company</TH>
          <TH>Email</TH>
          <TH>Owner</TH>
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
            <TD className="text-muted-foreground">{c.title ?? '—'}</TD>
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
            <TD className="text-muted-foreground">{c.email ?? '—'}</TD>
            <TD className="text-muted-foreground">
              {c.ownerEmail ? c.ownerEmail.split('@')[0] : '—'}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
