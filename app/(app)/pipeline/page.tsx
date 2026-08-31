import { Kanban } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { hasDb } from '@/lib/prisma';
import { pipelineBand } from '@/lib/band';
import { rangeParam } from '@/lib/range';
import { board, BOARD_LIMIT } from '@/lib/pipeline';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { convert } from '@/lib/currency';
import { currencySettings } from '@/lib/settings';
import { PipelineViews } from './PipelineViews';

export const metadata = { title: 'Pipeline · Growth Center' };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Pipeline" subtitle="Opportunities from first conversation to won." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days, bucket } = rangeParam(params);
  const [data, band, fx] = await Promise.all([
    board(),
    pipelineBand(days, bucket),
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

  const columns = data.columns.map((c) => ({
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
      value: convert(Number(o.value), o.currency, fx) ?? 0,
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

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${fmtNumber(openCount)} open · ${money(total)} total · ${money(weighted)} weighted`}
        actions={<RangePicker current={value} />}
      />
      <MetricsBand {...band} />

      {data.truncated ? (
        <p className="mb-3 rounded-xl border border-border bg-card px-4 py-2.5 text-[12.5px] text-muted-foreground">
          Showing the {BOARD_LIMIT} most recently updated of {fmtNumber(data.openTotal)} open
          deals. The totals above cover all of them.
        </p>
      ) : null}

      <PipelineViews columns={columns} currency={fx.reporting} />
    </>
  );
}
