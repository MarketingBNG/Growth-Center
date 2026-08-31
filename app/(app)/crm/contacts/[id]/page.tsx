import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LeadStatusBadge } from '@/components/patterns/badges';
import { Timeline } from '@/components/patterns/timeline';
import { TaskList } from '@/components/patterns/task-list';
import { NoteBox } from '../../../leads/[id]/NoteBox';
import { getContact } from '@/lib/crm';
import { hasDb } from '@/lib/prisma';
import { fmtMoney, fmtRelative, safeUrl } from '@/lib/format';

export const metadata = { title: 'Contact · Growth Center' };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const contact = await getContact((await params).id);
  if (!contact) notFound();

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');

  return (
    <>
      <Link
        href="/crm?tab=contacts"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Contacts
      </Link>

      <div className="pb-5">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{name}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {[contact.title, contact.company?.name].filter(Boolean).join(' · ') || 'No company'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Email" value={contact.email} />
              <Detail label="Phone" value={contact.phone} />
              <Detail label="Title" value={contact.title} />
              <Detail label="Owner" value={contact.ownerEmail ?? 'Unassigned'} />
              <Detail
                label="Company"
                value={
                  contact.company ? (
                    <Link
                      href={`/crm/companies/${contact.company.id}`}
                      className="hover:text-primary"
                    >
                      {contact.company.name}
                    </Link>
                  ) : null
                }
              />
              <Detail
                label="LinkedIn"
                value={
                  safeUrl(contact.linkedin) ? (
                    <a
                      href={safeUrl(contact.linkedin)!}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary"
                    >
                      Profile
                    </a>
                  ) : null
                }
              />
            </CardContent>
          </Card>

          {contact.opportunities.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Opportunities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.opportunities.map((o) => (
                  <Link
                    key={o.id}
                    href={`/pipeline/${o.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span>{o.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone="info">{o.stage.name}</Badge>
                      <span className="tnum text-muted-foreground">{fmtMoney(Number(o.value), false, o.currency)}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {contact.leads.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Leads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span className="text-muted-foreground">
                      {l.sourceType.replaceAll('_', ' ')}
                    </span>
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
              <NoteBox contactId={contact.id} />
              {contact.noteEntries.map((n) => (
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
          <TaskList tasks={contact.tasks} />

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <Timeline entries={contact.activities} />
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
