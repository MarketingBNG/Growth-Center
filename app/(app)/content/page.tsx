import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, FileText } from 'lucide-react';
import { StatTile } from '@/components/patterns/stat-tile';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hasDb } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { contentBoard } from '@/lib/content';
import {
  addMonths,
  contentCalendar,
  currentMonth,
  monthKey,
  parseMonth,
} from '@/lib/content-calendar';
import { fmtCompact, fmtDate, fmtNumber } from '@/lib/format';
import { NewContentButton } from './NewContentButton';
import { AutofillButton } from './AutofillButton';
import { ContentCard } from './ContentCard';
import { CalendarGrid, type CalendarCell } from './CalendarGrid';
import { ImportCalendarButton } from './ImportCalendarButton';
import { ExportCalendarButton } from './ExportCalendarButton';

export const metadata = { title: 'Content · Growth Center' };

// §15.3's nine, plus the archive. The three review stages share a tone deliberately:
// they are one waiting-on-somebody phase from the board's point of view, and colouring
// them differently would imply a difference in urgency the workflow does not have.
const STATUS_TONE = {
  idea: 'neutral',
  brief: 'neutral',
  draft: 'info',
  technical_check: 'warning',
  proofread: 'warning',
  partner_approval: 'warning',
  scheduled: 'info',
  published: 'success',
  repurposed: 'success',
  archived: 'neutral',
} as const;

/**
 * Two views of one set of rows.
 *
 * Calendar first, because that is what the page is called downstairs and what people come
 * to it holding: a month, planned, with something going out on the 12th. The board is
 * §15.3's pipeline and answers a different question — what is in flight and who has it —
 * so it stays, one click away.
 *
 * The view and the month live in the URL rather than in component state, so a particular
 * month is a link somebody can send.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

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
  const canWrite = can(user?.role ?? 'user', 'content:write');

  const view = params.view === 'board' ? 'board' : 'calendar';
  const month = parseMonth(typeof params.month === 'string' ? params.month : null) ?? currentMonth();

  const [board, calendar] = await Promise.all([
    contentBoard(),
    view === 'calendar' ? contentCalendar(month) : null,
  ]);
  const { columns, totals, pieces } = board;

  const href = (next: { view?: string; month?: string }) =>
    `/content?view=${next.view ?? view}&month=${next.month ?? monthKey(month)}`;

  return (
    <>
      <PageHeader
        title="Content"
        subtitle={`${totals.total} pieces · ${totals.published} published`}
        actions={
          <>
            {view === 'calendar' ? (
              <>
                <ExportCalendarButton month={calendar!.monthKey} label={calendar!.label} />
                {canWrite ? (
                  <ImportCalendarButton
                    month={calendar!.monthKey}
                    replaceable={calendar!.lastImport !== null}
                  />
                ) : null}
              </>
            ) : null}
            {/* §15.4. "Hand-filled boards decay in three weeks." */}
            <AutofillButton />
            <NewContentButton />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 pb-4">
        <ViewTab href={href({ view: 'calendar' })} active={view === 'calendar'} icon={<CalendarDays />}>
          Calendar
        </ViewTab>
        <ViewTab href={href({ view: 'board' })} active={view === 'board'} icon={<Columns3 />}>
          Board
        </ViewTab>
      </div>

      {view === 'calendar' ? (
        <CalendarView calendar={calendar!} href={href} />
      ) : pieces.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="size-6" />}
            title="No content yet"
            hint="Add an idea, or import a month's calendar from the Calendar tab."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Published" value={fmtNumber(totals.published)} />
            <StatTile label="Views" value={fmtCompact(totals.views)} />
            <StatTile label="Leads generated" value={fmtNumber(totals.leads)} />
            <StatTile
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

/**
 * The month, its provenance, and the grid.
 *
 * The provenance line is the part that was asked for and the part that did not exist:
 * a calendar on screen that nobody can attribute is a calendar people re-upload because
 * they cannot tell whether theirs is the one showing.
 */
function CalendarView({
  calendar,
  href,
}: {
  calendar: NonNullable<Awaited<ReturnType<typeof contentCalendar>>>;
  href: (next: { view?: string; month?: string }) => string;
}) {
  const { lastImport } = calendar;
  const today = new Date().toISOString().slice(0, 10);

  const weeks: CalendarCell[][] = calendar.weeks.map((week) =>
    week.map((day) => {
      const iso = day.date ? day.date.toISOString().slice(0, 10) : null;
      return {
        date: iso,
        day: day.date ? day.date.getUTCDate() : null,
        today: iso === today,
        // Every field, not just the ones the tile shows: the editor this opens sends the
        // whole record back, so anything missing here would return as empty and clear a
        // field nobody edited.
        pieces: day.pieces.map((p) => ({
          id: p.id,
          title: p.title,
          format: p.format,
          status: p.status,
          publishDate: p.publishDate.toISOString().slice(0, 10),
          publishMinute: p.publishMinute,
          assetShape: p.assetShape,
          authorEmail: p.authorEmail,
          designerEmail: p.designerEmail,
          partnerVoice: p.partnerVoice,
          channelSlug: p.channelSlug,
          brief: p.brief,
          url: p.url,
          assetUrl: p.assetUrl,
          targetKeyword: p.targetKeyword,
          topicCluster: p.topicCluster,
          segment: p.segment,
          serviceLine: p.serviceLine,
          tags: p.tags,
          imported: p.imported,
          approved: p.approved,
        })),
      };
    }),
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-1.5">
          <Button asChild size="icon" variant="outline" aria-label="Previous month">
            <Link href={href({ month: monthKey(addMonths(calendar.month, -1)) })}>
              <ChevronLeft />
            </Link>
          </Button>
          <p className="min-w-[9.5rem] text-center text-sm font-semibold">{calendar.label}</p>
          <Button asChild size="icon" variant="outline" aria-label="Next month">
            <Link href={href({ month: monthKey(addMonths(calendar.month, 1)) })}>
              <ChevronRight />
            </Link>
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {calendar.counts.total} {calendar.counts.total === 1 ? 'piece' : 'pieces'}
          {calendar.counts.imported ? ` · ${calendar.counts.imported} imported` : ''}
          {calendar.counts.byHand ? ` · ${calendar.counts.byHand} added here` : ''}
          {calendar.counts.published ? ` · ${calendar.counts.published} published` : ''}
        </p>
      </div>

      {lastImport ? (
        <div className="mb-3 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
          <p className="text-[11.5px]">
            <span className="font-medium">{lastImport.fileName}</span>
            <span className="text-muted-foreground">
              {' '}· imported by {lastImport.importedByEmail.split('@')[0]} on{' '}
              {fmtDate(lastImport.createdAt)} · {lastImport.created}{' '}
              {lastImport.created === 1 ? 'piece' : 'pieces'} from {lastImport.rowsRead} rows
              {lastImport.skipped ? `, ${lastImport.skipped} refused` : ''}
            </span>
          </p>
          {lastImport.remaining !== lastImport.created ? (
            <p className="pt-0.5 text-[11px] text-muted-foreground">
              {lastImport.remaining} of them {lastImport.remaining === 1 ? 'is' : 'are'} still here — the
              rest have been replaced or deleted since.
            </p>
          ) : null}
          {lastImport.skippedReasons.length ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-[11px] font-medium text-warning-strong">
                What was refused
              </summary>
              <ul className="pt-1 text-[11px] text-muted-foreground">
                {lastImport.skippedReasons.slice(0, 10).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {lastImport.skippedReasons.length > 10 ? (
                  <li>…and {lastImport.skippedReasons.length - 10} more.</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {calendar.counts.total === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="size-6" />}
            title={`Nothing planned for ${calendar.label}`}
            hint="Import the month's calendar as a .csv or .xlsx, or add a piece and give it a date."
          />
        </Card>
      ) : (
        <CalendarGrid weeks={weeks} />
      )}
    </>
  );
}

function ViewTab({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button asChild size="sm" variant={active ? 'secondary' : 'ghost'}>
      <Link href={href} aria-current={active ? 'page' : undefined}>
        {icon}
        {children}
      </Link>
    </Button>
  );
}

