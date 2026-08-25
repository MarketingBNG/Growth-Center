import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { hasDb } from '@/lib/prisma';
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
            hint="Add an idea, or run npm run db:seed for demo data."
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

          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((col) => (
              <div key={col.status} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-card/60">
                <div className="flex items-baseline justify-between border-b border-border px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold capitalize">{col.status}</p>
                    <Badge tone={STATUS_TONE[col.status]}>{col.pieces.length}</Badge>
                  </div>
                </div>
                <div className="flex-1 space-y-2 p-2">
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
                      }}
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
