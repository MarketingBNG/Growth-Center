import { Kanban } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, noDatabasePage } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { hasDb } from '@/lib/platform/prisma';
import { pipelineBand } from '@/lib/analytics/band';
import { resolveRange, type PageParams } from '@/lib/shared/range';
import { board, BOARD_LIMIT } from '@/lib/pipeline/pipeline';
import { fmtMoney, fmtNumber } from '@/lib/shared/format';
import { convertOrDrop, warnUnconverted } from '@/lib/shared/currency';
import { currencySettings } from '@/lib/platform/settings';
import { PipelineViews } from './PipelineViews';

export const metadata = { title: 'Pipeline · Growth Center' };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  if (!hasDb()) {
    return noDatabasePage('Pipeline', 'Opportunities from first conversation to won.');
  }

  const params = await searchParams;
  const { value, spec, bucket } = resolveRange(params);
  const [data, band, fx] = await Promise.all([
    board(),
    pipelineBand(spec, bucket),
    currencySettings(),
  ]);
  // Money renders in the workspace's reporting currency. Aliased so a call site cannot
  // silently fall back to dollars, which is how rupees came to be printed with a $.
  const money = (n: number | null | undefined) => fmtMoney(n, false, band.currency);


  if (!data) {
    return (
      <>
        <PageHeader title="Pipeline" subtitle="Opportunities from first conversation to won." />
        <Card>
          <EmptyState
            icon={<Kanban className="size-6" />}
            title="No pipeline configured"
            hint="No pipeline exists yet. One is created with its stages when the workspace is first set up."
          />
        </Card>
      </>
    );
  }

  // Read off the KPI cards rather than summed from the board.
  //
  // The board loads the 300 most recently touched deals, and this workspace has 2,082
  // open — so the subtitle summed a seventh of the pipeline and printed it as the whole
  // thing, directly above a note promising that "the totals above cover all of them".
  // The cards come from openPipeline(), which values every open deal.
  const kpi = (key: string) => {
    const value = band.kpis.find((k) => k.key === key)?.value;
    return typeof value === 'number' ? value : 0;
  };
  const openCount = kpi('openDeals');
  const total = kpi('totalValue');
  const weighted = kpi('weighted');

  const dropped = new Set<string>();
  const columns = data.columns.map((c) => ({
    total: c.total,
    stage: {
      id: c.stage.id,
      name: c.stage.name,
      probability: c.stage.probability,
      isWon: c.stage.isWon,
      isLost: c.stage.isLost,
    },
    cards: c.cards.map((o) => ({
      id: o.id,
      name: o.name,
      // Converted here rather than shown as written: the board sums each column, and a
      // column adding rupees to dollars is the figure people act on.
      value: convertOrDrop(Number(o.value), o.currency, fx, dropped),
      probability: o.probability,
      ownerEmail: o.ownerEmail,
      source: o.source,
      expectedCloseDate: o.expectedCloseDate ? o.expectedCloseDate.toISOString() : null,
      companyName: o.company?.name ?? null,
      contactName: o.contact
        ? [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' ')
        : null,
    })),
  }));
  warnUnconverted('pipeline board', dropped, 'those deals show as zero on their cards and in their column total');

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${fmtNumber(openCount)} open · ${money(total)} total · ${money(weighted)} weighted`}
        actions={<RangePicker current={value} />}
      />
      <MetricsBand {...band} />

      {data.truncated ? (
        <p className="mb-3 rounded-xl border border-border bg-card px-4 py-2.5 text-body text-muted-foreground">
          Each column shows its {BOARD_LIMIT} most recently updated deals — the ones still
          open, or for the won and lost columns, the ones that ended there. The figures
          above cover all {fmtNumber(data.openTotal)} open deals, and each column says how
          many it is holding back.
        </p>
      ) : null}

      {/* Says out loud that there are two ways to move a deal. The board's is a drag,
          which is invisible until somebody tries it and impossible without a pointer;
          the table's stage dropdown is the same move from the keyboard. Neither was
          discoverable, and one of them is the accessible one. */}
      <p className="mb-3 text-body text-muted-foreground">
        Drag a card between columns to move a deal, or switch to Table and change its
        stage from the dropdown — the same move, reachable from the keyboard.
      </p>

      <PipelineViews columns={columns} currency={fx.reporting} />
    </>
  );
}
