import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { db, hasDb } from '@/lib/prisma';
import { campaignPerformance, campaignTotals } from '@/lib/campaigns';
import { channelPerformance, rangeFor } from '@/lib/metrics';
import { rangeParam } from '@/lib/range';
import { marketingBand } from '@/lib/band';
import { fmtMoney, fmtNumber, fmtPercent, fmtRatio } from '@/lib/format';
import { SourceBadge } from '@/components/patterns/source-badge';
import { DEMO_SOURCE, sourceMeta } from '@/lib/sources';
import { ChannelFilter } from './ChannelFilter';

export const metadata = { title: 'Marketing · Growth Center' };

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Marketing" subtitle="Campaigns and channels, spend against return." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days, bucket } = rangeParam(params);
  const { current } = rangeFor(days);
  const channelId = typeof params.channelId === 'string' ? params.channelId : undefined;
  const source = typeof params.source === 'string' ? params.source : '';

  const [channels, allChannels, rows, band] = await Promise.all([
    channelPerformance(current),
    db().channel.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    campaignPerformance(current, channelId),
    marketingBand(days, bucket),
  ]);

  // Money renders in the workspace's reporting currency. Aliased so a call site cannot
  // silently fall back to dollars, which is how rupees came to be printed with a $.
  const money = (n: number | null | undefined) => fmtMoney(n, false, band.currency);

  // Which sources actually appear in this period, so the filter never offers an option
  // that would return nothing.
  const presentSources = [...new Set(rows.map((r) => r.source ?? DEMO_SOURCE))].map((id) => ({
    id,
    name: sourceMeta(id).name,
  }));

  const filtered = source ? rows.filter((r) => (r.source ?? DEMO_SOURCE) === source) : rows;

  const totals = campaignTotals(filtered);
  const active = filtered.filter((r) => r.spend > 0 || r.leads > 0 || r.revenue > 0);

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Campaigns and channels, spend against return."
        actions={<RangePicker current={value} />}
      />

      <ChannelFilter
        channels={allChannels}
        current={channelId ?? ''}
        sources={presentSources}
        currentSource={source}
      />

      <MetricsBand {...band} />

      <div className="pb-[18px]">
        <BarChart
          title="Revenue by channel"
          data={channels.filter((c) => c.revenue > 0).map((c) => ({ label: c.name, value: c.revenue }))}
          kind="money"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        {active.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-6" />}
            title="No campaign activity in this period"
            hint="Widen the date range, or connect Meta Ads and Google Ads to pull spend automatically."
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[1180px]">
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Channel</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Impr.</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">CTR</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">CPL</TH>
                  <TH className="text-right">Deals</TH>
                  <TH className="text-right">Cust.</TH>
                  <TH className="text-right">New revenue</TH>
                  <TH className="text-right">CAC</TH>
                  <TH className="text-right">ROAS</TH>
                </TR>
              </THead>
              <TBody>
                {active.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <span className="font-medium">{c.name}</span>
                      {/* A campaign with no source came from the seeder, whatever its
                          channel says — that distinction is the whole point here. */}
                      <SourceBadge source={c.source} className="ml-1.5" />
                    </TD>
                    <TD className="text-muted-foreground">{c.channelName}</TD>
                    <TD className="text-right tnum">{money(c.spend)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(c.impressions)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(c.clicks)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.ctr === null ? '—' : fmtPercent(c.ctr, 2)}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.costPerLead === null ? '—' : money(c.costPerLead)}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(c.opportunities)}</TD>
                    <TD className="text-right tnum">{fmtNumber(c.customers)}</TD>
                    <TD className="text-right tnum">{money(c.revenue)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.cac === null ? '—' : money(c.cac)}
                    </TD>
                    <TD className="text-right tnum">
                      {c.roas === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={c.roas >= 1 ? 'text-success' : 'text-destructive'}>
                          {fmtRatio(c.roas)}
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
                {/* Ratios here are recomputed from the totals, never averaged from the
                    rows above — averaging ratios makes a footer disagree with its own
                    columns. */}
                <TR className="border-t-2 border-border font-semibold hover:bg-transparent">
                  <TD colSpan={2}>Total</TD>
                  <TD className="text-right tnum">{money(totals.spend)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.impressions)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.clicks)}</TD>
                  <TD className="text-right tnum">{totals.ctr === null ? '—' : fmtPercent(totals.ctr, 2)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.leads)}</TD>
                  <TD className="text-right tnum">
                    {totals.costPerLead === null ? '—' : money(totals.costPerLead)}
                  </TD>
                  <TD className="text-right tnum">{fmtNumber(totals.opportunities)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.customers)}</TD>
                  <TD className="text-right tnum">{money(totals.revenue)}</TD>
                  <TD className="text-right tnum">{totals.cac === null ? '—' : money(totals.cac)}</TD>
                  <TD className="text-right tnum">{totals.roas === null ? '—' : fmtRatio(totals.roas)}</TD>
                </TR>
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
