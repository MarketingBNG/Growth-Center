import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { hasDb } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { contentBoard } from '@/lib/content';
import { fmtCompact, fmtDate, fmtNumber } from '@/lib/format';
import { NewContentButton } from './NewContentButton';
import { ContentCard } from './ContentCard';

export const metadata = { title: 'Content · Growth Center' };

const STATUS_TONE = {
  idea: 'neutral',
  planned: 'info',
  draft: 'info',
  review: 'warning',
  published: 'success',
  archived: 'neutral',
} as const;

export default async function ContentPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Content" subtitle="From idea to published, with what it produced." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  // §21.2's approving identity. The owner alone holds `approve`, so an admin can write
  // and move a piece without being able to sign it off — which is the separation the
  // permission was created for and, until this page, nothing used.
  const user = await currentUser();
  const canApprove = can(user?.role ?? 'user', 'approve');

  const { columns, totals, pieces } = await contentBoard();

  return (
    <>
      <PageHeader
        title="Content"
        subtitle={`${totals.total} pieces · ${totals.published} published`}
        actions={<NewContentButton />}
      />

      {pieces.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="size-6" />}
            title="No content yet"
            hint="Add an idea to start planning. Nothing imports content — this board is filled by hand."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Published" value={fmtNumber(totals.published)} />
            <Stat label="Views" value={fmtCompact(totals.views)} />
            <Stat label="Leads generated" value={fmtNumber(totals.leads)} />
            <Stat
              label="Leads per 1k views"
              value={totals.leadsPerThousandViews === null ? '—' : totals.leadsPerThousandViews.toFixed(1)}
            />
          </div>

          {/* A grid rather than fixed-width flex columns: four 256px columns plus gaps
              overflowed the content area, so the last status was clipped mid-word.
              items-start keeps a near-empty column from stretching to the tallest one. */}
          <div className="grid items-start gap-3.5 pb-2 sm:grid-cols-2 lg:grid-cols-4">
            {columns.map((col) => (
              <div
                key={col.status}
                className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-3.5 shadow-card"
              >
                <div className="flex items-baseline justify-between gap-2 pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[13px] font-bold capitalize">{col.status}</p>
                    <Badge tone={STATUS_TONE[col.status]}>{col.pieces.length}</Badge>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  {col.pieces.length === 0 ? (
                    <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">Nothing here</p>
                  ) : col.pieces.map((p) => (
                    <ContentCard
                      key={p.id}
                      piece={{
                        id: p.id,
                        title: p.title,
                        format: p.format,
                        status: p.status,
                        authorEmail: p.authorEmail,
                        publishDate: p.publishDate ? fmtDate(p.publishDate) : null,
                        views: p.views,
                        leadsGenerated: p.leadsGenerated,
                        campaignName: p.campaign?.name ?? null,
                        url: p.url,
                        approval: p.approval,
                      }}
                      canApprove={canApprove}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="pt-1 text-2xl font-semibold tracking-tight tnum">{value}</p>
    </div>
  );
}
