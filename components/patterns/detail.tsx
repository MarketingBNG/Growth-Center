import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressLink } from '@/components/NavProgress';
import { NoteBox } from '@/app/(app)/leads/[id]/NoteBox';
import { fmtRelative } from '@/lib/shared/format';

/**
 * The pieces every record page is built from.
 *
 * There are four of those pages — company, contact, lead, deal — and they were written
 * four times rather than once. `Detail` below was defined in all four, byte-identical in
 * three of them; the notes card was thirteen identical lines differing only in which id
 * it handed NoteBox; the back link carried the same class string in all four. Nothing
 * here changes how any of them look.
 */

/** One labelled field. The `|| '—'` is deliberate and load-bearing: most CRM fields are
 *  empty on imported records, and a blank space reads as a broken layout where a dash
 *  reads as "nothing recorded". */
export function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Only the lead page uses this, to span a field across the two-column grid. */
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-meta uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm">{value || '—'}</p>
    </div>
  );
}

/** The way back to the list this record came from. `progress` picks the pipeline page's
 *  ProgressLink, which drives the top loading bar; the other three use a plain Link. */
export function BackLink({
  href,
  label,
  progress = false,
}: {
  href: string;
  label: string;
  progress?: boolean;
}) {
  const Tag = progress ? ProgressLink : Link;
  return (
    <Tag
      href={href}
      className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> {label}
    </Tag>
  );
}

/** Which record a new note hangs off. Exactly the shape NoteBox already takes, passed
 *  straight through, so the four pages keep naming their own foreign key. */
export type NoteParent = {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
};

export type NoteEntry = {
  id: string;
  body: string;
  authorEmail: string;
  createdAt: Date;
};

/** The notes card, with its composer. Identical on all four pages down to the `space-y-3`. */
export function NotesCard({ parent, notes }: { parent: NoteParent; notes: NoteEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <NoteBox {...parent} />
        {notes.map((n) => (
          <div key={n.id} className="rounded-md border border-border px-3 py-2">
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            <p className="mt-1 text-meta text-muted-foreground">
              {n.authorEmail.split('@')[0]} · {fmtRelative(n.createdAt)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * A record's title, with whatever badge belongs beside it and whatever actions belong
 * opposite it.
 *
 * Not folded into PageHeader, which every list page uses: this one puts a badge inline
 * with the h1 and pushes actions to the far edge with `justify-between`, where PageHeader
 * uses `ml-auto` and has no slot next to the title. Teaching PageHeader both shapes would
 * have meant branching inside a component twenty-odd pages already depend on.
 *
 * The contact page keeps its own plainer header rather than using this. It has neither a
 * badge nor actions, and its heading sits in a block `<div>`; passing it through a flex
 * container would make its subtitle shrink to content width and wrap differently on a
 * narrow screen.
 */
export function DetailHeader({
  title,
  badge,
  subtitle,
  actions,
}: {
  title: string;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-display font-extrabold leading-tight tracking-[-0.03em]">{title}</h1>
          {badge}
        </div>
        {subtitle}
      </div>
      {actions}
    </div>
  );
}
