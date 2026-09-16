import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink, Detail, HistoryCard, LinkedRow, NotesCard } from '@/components/patterns/detail';
import { Badge } from '@/components/ui/badge';
import { LeadStatusBadge } from '@/components/patterns/badges';
import { TaskList } from '@/components/patterns/task-list';
import { getContact } from '@/lib/crm/crm';
import { leadSourceLabel } from '@/lib/integrations/crm-mapping';
import { hasDb } from '@/lib/platform/prisma';
import { fmtMoney, fmtRelative, safeUrl } from '@/lib/shared/format';

export const metadata = { title: 'Contact · Growth Center' };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) notFound();
  const contact = await getContact((await params).id);
  if (!contact) notFound();

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');

  return (
    <>
      <BackLink href="/crm?tab=contacts" label="Contacts" />

      <div className="pb-5">
        <h1 className="text-display font-extrabold leading-tight tracking-[-0.03em]">{name}</h1>
        <p className="mt-1 text-label text-muted-foreground">
          {[contact.title, contact.company?.name].filter(Boolean).join(' · ') || 'No company'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
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
                  <LinkedRow key={o.id} href={`/pipeline/${o.id}`}>
                    <span>{o.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone="info">{o.stage.name}</Badge>
                      <span className="tnum text-muted-foreground">{fmtMoney(Number(o.value), false, o.currency)}</span>
                    </span>
                  </LinkedRow>
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
                  <LinkedRow key={l.id} href={`/leads/${l.id}`}>
                    <span className="text-muted-foreground">
                      {leadSourceLabel(l.sourceDetail, l.sourceType)}
                    </span>
                    <span className="flex items-center gap-2">
                      <LeadStatusBadge status={l.status} />
                      <span className="text-xs text-muted-foreground">
                        {fmtRelative(l.createdAt)}
                      </span>
                    </span>
                  </LinkedRow>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <NotesCard parent={{ contactId: contact.id }} notes={contact.noteEntries} />
        </div>

        <div className="min-w-0 space-y-4">
          <TaskList tasks={contact.tasks} />

          <HistoryCard entries={contact.activities} />
        </div>
      </div>
    </>
  );
}
