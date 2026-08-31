import Link from 'next/link';
import { ChartLine, Plug } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { SourceBadge } from '@/components/patterns/source-badge';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { TrendChart } from '@/components/charts/TrendChart';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { StateBadge, stateLabel } from '@/components/patterns/integration-state';
import { db, hasDb } from '@/lib/prisma';
import { channelPerformance, rangeFor, trend } from '@/lib/metrics';
import { cards } from '@/lib/integrations/service';
import { rangeParam } from '@/lib/range';
import { analyticsBand } from '@/lib/band';
import { fmtDaysAgo, fmtNumber, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Analytics · Growth Center' };

/** What one row of a metric counts. The stored entityType is an internal enum-ish
 *  string; this is the reader's word for it. */
const SCOPES: Record<string, string> = {
  site: 'Whole site',
  seo_keyword: 'Keyword',
  seo_page: 'Page',
  ad_campaign: 'Campaign',
  social_account: 'Social account',
  outreach_sequence: 'Sequence',
  zoho_module: 'CRM module',
};

const scopeLabel = (t: string) => SCOPES[t] ?? t.replaceAll('_', ' ');

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
    // Grouped by entityType as well as metricKey. Without it "clicks" collapsed the
    // per-keyword rows and the per-page rows into one 6,142-row line, and sat in the
    // table beside "search clicks" with nothing to say what either one counted.
    db().metricSnapshot.groupBy({
      by: ['source', 'metricKey', 'entityType'],
      _count: { _all: true },
      _max: { date: true },
    }),
  ]);

  // Every provider that actually writes into the metrics layer, plus the reporting
  // categories whether or not they have written yet. Filtering on category alone listed
  // three providers next to a table naming six, and the two cards contradicted each other.
  const writing = new Set(sources.map((s) => s.source));
  const analyticsProviders = providers.filter(
    (p) => ['analytics', 'seo', 'ads'].includes(p.category) || writing.has(p.id),
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Every source writes into one metrics table; every chart reads from it."
        actions={<RangePicker current={value} />}
      />

      <MetricsBand {...band} />

      {/* Sessions and spend are both time series and both get their own axis — the band's
          chart used to carry spend against revenue, where it was a flat line at zero. */}
      <div className="grid gap-3.5 pb-[18px] lg:grid-cols-2">
        <TrendChart
          title="Sessions"
          subtitle={bucket === 'month' ? 'By month' : 'By day'}
          data={series}
          series={[{ key: 'visitors', label: 'Sessions', kind: 'number' }]}
          height={200}
        />
        <TrendChart
          title="Ad spend"
          subtitle={bucket === 'month' ? 'By month' : 'By day'}
          data={series}
          series={[{ key: 'spend', label: 'Spend', kind: 'money' }]}
          currency={band.currency}
          height={200}
        />
      </div>

      <div className="pb-[18px]">
        <BarChart
          title="Leads by channel"
          data={channels.filter((c) => c.leads > 0).map((c) => ({ label: c.name, value: c.leads }))}
        />
      </div>

      {/* Both cards run full width and stack. Side by side, the five-column metrics table
          was clipped at the card edge and the short sources card left half a screen of
          dead space beside it. */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Data sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                          : p.lastSyncAt
                            ? `${stateLabel(p.state)} — last sync ${fmtRelative(p.lastSyncAt)}`
                            : stateLabel(p.state)}
                  </p>
                </div>
                <StateBadge state={p.state} />
              </div>
            ))}
            </div>
            <Button asChild variant="outline" size="sm" className="mt-3">
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
              hint="Connect Google Analytics on the Integrations page to start collecting figures."
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Source</TH>
                    <TH>Metric</TH>
                    <TH>Per</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Latest</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...sources]
                    .sort(
                      (a, b) =>
                        a.source.localeCompare(b.source) ||
                        a.metricKey.localeCompare(b.metricKey) ||
                        a.entityType.localeCompare(b.entityType),
                    )
                    .map((s) => (
                      <TR key={`${s.source}-${s.metricKey}-${s.entityType}`}>
                        <TD>
                          <SourceBadge source={s.source} full />
                        </TD>
                        <TD className="text-muted-foreground">{s.metricKey.replaceAll('_', ' ')}</TD>
                        <TD className="text-muted-foreground">{scopeLabel(s.entityType)}</TD>
                        <TD className="text-right tnum">{fmtNumber(s._count._all)}</TD>
                        <TD className="text-right text-muted-foreground">{fmtDaysAgo(s._max.date)}</TD>
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
