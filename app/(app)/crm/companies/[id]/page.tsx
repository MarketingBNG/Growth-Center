import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LeadStatusBadge } from '@/components/patterns/badges';
import { Timeline } from '@/components/patterns/timeline';
import { TaskList } from '@/components/patterns/task-list';
import { NoteBox } from '../../../leads/[id]/NoteBox';
import { getCompany } from '@/lib/crm';
import { hasDb } from '@/lib/prisma';
import { fmtDate, fmtMoney, fmtRelative, safeUrl } from '@/lib/format';
import { convert } from '@/lib/currency';
import { currencySettings } from '@/lib/settings';

export const metadata = { title: 'Company · Growth Center' };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const company = await getCompany((await params).id);
  if (!company) notFound();

  // The individual entries below are shown in the currency each was billed in; this
  // total adds them up, so it has to convert first or it is rupees plus dollars.
  const fx = await currencySettings();
  const revenue =
    company.customer?.revenue.reduce(
      (t, r) => t + (convert(Number(r.amount), r.currency, fx) ?? 0),
      0,
    ) ?? 0;

  return (
    <>
      <Link
        href="/crm"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> CRM
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{company.name}</h1>
            {company.customer ? <Badge tone="success">customer</Badge> : null}
          </div>
          {/* Domain, industry and country are empty on all 2,953 imported companies —
              Zoho holds none of the three — so this line read "No details recorded"
              under every name on the site while the phone number and owner sat unread
              in the same row. */}
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {[company.domain, company.industry, company.country, company.phone]
              .filter(Boolean)
              .join(' · ') || 'No details recorded'}
          </p>
        </div>
        {revenue > 0 ? (
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Revenue</p>
            <p className="text-lg font-semibold tnum">{fmtMoney(revenue, false, fx.reporting)}</p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* The contact page had a Details card and the company page had none, so
              everything the sync does carry about an account — phone, website, size,
              country, owner — had nowhere to appear. */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Phone" value={company.phone} />
              <Detail
                label="Website"
                value={
                  safeUrl(company.website) ? (
                    <a href={safeUrl(company.website)!} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {company.website}
                    </a>
                  ) : null
                }
              />
              <Detail label="Industry" value={company.industry} />
              <Detail label="Country" value={company.country} />
              <Detail label="Size" value={company.size} />
              <Detail label="Owner" value={company.ownerEmail ?? 'Unassigned'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts ({company.contacts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {company.contacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No contacts yet.</p>
              ) : (
                company.contacts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/crm/contacts/${c.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span>
                      {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                      {c.title ? (
                        <span className="text-muted-foreground"> · {c.title}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.email}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Opportunities ({company.opportunities.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {company.opportunities.length === 0 ? (
                <p className="text-xs text-muted-foreground">No deals yet.</p>
              ) : (
                company.opportunities.map((o) => (
                  <Link
                    key={o.id}
                    href={`/pipeline/${o.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span>{o.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={o.stage.isWon ? 'success' : o.stage.isLost ? 'danger' : 'info'}>
                        {o.stage.name}
                      </Badge>
                      <span className="tnum text-muted-foreground">{fmtMoney(Number(o.value), false, o.currency)}</span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {company.leads.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Leads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {company.leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span>{[l.firstName, l.lastName].filter(Boolean).join(' ')}</span>
                    <span className="flex items-center gap-2">
                      <LeadStatusBadge status={l.status} />
                      <span className="text-xs text-muted-foreground">
                        {fmtRelative(l.createdAt)}
                      </span>
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
              <NoteBox companyId={company.id} />
              {company.noteEntries.map((n) => (
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
          <TaskList tasks={company.tasks} />

          {company.customer ? (
            <Card>
              <CardHeader>
                <CardTitle>Revenue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Customer since {fmtDate(company.customer.wonAt)}
                </p>
                {company.customer.revenue.map((r) => (
                  <div key={r.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{fmtDate(r.date)}</span>
                    <span className="tnum">{fmtMoney(Number(r.amount), false, r.currency)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <Timeline entries={company.activities} />
          </Card>
        </div>
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
