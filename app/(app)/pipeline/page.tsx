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
import { pipelineValue } from '@/lib/calc';
import { fmtMoney, fmtNumber } from '@/lib/format';
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
  const [data, band] = await Promise.all([board(), pipelineBand(days, bucket)]);

  if (!data) {
    return (
      <>
        <PageHeader title="Pipeline" subtitle="Opportunities from first conversation to won." />
        <Card>
          <EmptyState
            icon={<Kanban className="size-6" />}
            title="No pipeline configured"
            hint="Run npm run db:seed to create the default pipeline and its stages."
          />
        </Card>
      </>
    );
  }

  const open = data.columns.flatMap((c) => c.cards);
  const { total, weighted } = pipelineValue(open);

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
      value: Number(o.value),
      probability: o.probability,
      ownerEmail: o.ownerEmail,
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
        subtitle={`${open.length} open · ${fmtMoney(total)} total · ${fmtMoney(weighted)} weighted`}
        actions={<RangePicker current={value} />}
      />
      <MetricsBand {...band} />

      {data.truncated ? (
        <p className="mb-3 rounded-xl border border-border bg-card px-4 py-2.5 text-[12.5px] text-muted-foreground">
          Showing the {BOARD_LIMIT} most recently updated of {fmtNumber(data.openTotal)} open
          deals. The totals above cover all of them.
        </p>
      ) : null}

      <PipelineViews columns={columns} />
    </>
  );
}
