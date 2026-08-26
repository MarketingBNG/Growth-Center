import Link from 'next/link';
import { ChartLine, Plug } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { TrendChart } from '@/components/charts/TrendChart';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { StateBadge } from '@/components/patterns/integration-state';
import { db, hasDb } from '@/lib/prisma';
import { channelPerformance, rangeFor, trend } from '@/lib/metrics';
import { cards } from '@/lib/integrations/service';
import { rangeParam } from '@/lib/range';
import { analyticsBand } from '@/lib/band';
import { fmtNumber, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Analytics · Growth Center' };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="One metrics layer across every connected source." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days, bucket } = rangeParam(params);
  const { current } = rangeFor(days);

  const [series, band, channels, providers, sources] = await Promise.all([
    trend(current, bucket),
    analyticsBand(days, bucket),
    channelPerformance(current),
    cards(),
    // What is actually in the metrics layer, grouped by who wrote it. This is the
    // honest answer to "where do these numbers come from".
    db().metricSnapshot.groupBy({
      by: ['source', 'metricKey'],
      _count: { _all: true },
      _max: { date: true },
    }),
  ]);

  const analyticsProviders = providers.filter((p) => ['analytics', 'seo', 'ads'].includes(p.category));

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Every source writes into one metrics table; every chart reads from it."
        actions={<RangePicker current={value} />}
      />

      <MetricsBand {...band} />

      <div className="grid gap-3.5 pb-[18px] lg:grid-cols-2">
        <TrendChart
          title="Sessions"
          subtitle={bucket === 'month' ? 'By month' : 'By day'}
          data={series}
          series={[{ key: 'visitors', label: 'Sessions', kind: 'number' }]}
          height={200}
        />
        <BarChart
          title="Leads by channel"
          data={channels.filter((c) => c.leads > 0).map((c) => ({ label: c.name, value: c.leads }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analyticsProviders.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.state === 'connected'
                      ? `Last sync ${fmtRelative(p.lastSyncAt)}`
                      : p.state === 'demo_data'
                        ? 'Seeded demo figures — not a live connection'
                        : p.missingEnv.length
                          ? `Needs ${p.missingEnv.map((e) => e.name).join(', ')}`
                          : 'Not connected'}
                  </p>
                </div>
                <StateBadge state={p.state} />
              </div>
            ))}
            <Button asChild variant="outline" size="sm" className="mt-1">
              <Link href="/integrations">
                <Plug /> Integration Center
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>What is in the metrics layer</CardTitle>
          </CardHeader>
          {sources.length === 0 ? (
            <EmptyState
              icon={<ChartLine className="size-6" />}
              title="No metrics recorded yet"
              hint="Run npm run db:seed for demo figures, or connect a provider."
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Source</TH>
                    <TH>Metric</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Latest</TH>
                  </TR>
                </THead>
                <TBody>
                  {sources
                    .sort((a, b) => a.source.localeCompare(b.source) || a.metricKey.localeCompare(b.metricKey))
                    .map((s) => (
                      <TR key={`${s.source}-${s.metricKey}`}>
                        <TD>
                          <span className={s.source === 'demo' ? 'text-warning' : ''}>{s.source}</span>
                        </TD>
                        <TD className="text-muted-foreground">{s.metricKey.replaceAll('_', ' ')}</TD>
                        <TD className="text-right tnum">{fmtNumber(s._count._all)}</TD>
                        <TD className="text-right text-muted-foreground">{fmtRelative(s._max.date)}</TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
