import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { db, hasDb } from '@/lib/prisma';
import { campaignPerformance, campaignTotals } from '@/lib/campaigns';
import { channelPerformance, rangeFor } from '@/lib/metrics';
import { rangeParam } from '@/lib/range';
import { marketingBand } from '@/lib/band';
import { fmtMoney, fmtNumber, fmtPercent, fmtRatio } from '@/lib/format';
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

  const [channels, allChannels, rows, band] = await Promise.all([
    channelPerformance(current),
    db().channel.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    campaignPerformance(current, channelId),
    marketingBand(days, bucket),
  ]);

  const totals = campaignTotals(rows);
  const active = rows.filter((r) => r.spend > 0 || r.leads > 0 || r.revenue > 0);

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Campaigns and channels, spend against return."
        actions={<RangePicker current={value} />}
      />

      <ChannelFilter channels={allChannels} current={channelId ?? ''} />

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
                      {c.source ? (
                        <Badge tone="neutral" className="ml-1.5">
                          {c.source.replaceAll('_', ' ')}
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">{c.channelName}</TD>
                    <TD className="text-right tnum">{fmtMoney(c.spend)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(c.impressions)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(c.clicks)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.ctr === null ? '—' : fmtPercent(c.ctr, 2)}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.costPerLead === null ? '—' : fmtMoney(c.costPerLead)}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(c.opportunities)}</TD>
                    <TD className="text-right tnum">{fmtNumber(c.customers)}</TD>
                    <TD className="text-right tnum">{fmtMoney(c.revenue)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.cac === null ? '—' : fmtMoney(c.cac)}
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
                  <TD className="text-right tnum">{fmtMoney(totals.spend)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.impressions)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.clicks)}</TD>
                  <TD className="text-right tnum">{totals.ctr === null ? '—' : fmtPercent(totals.ctr, 2)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.leads)}</TD>
                  <TD className="text-right tnum">
                    {totals.costPerLead === null ? '—' : fmtMoney(totals.costPerLead)}
                  </TD>
                  <TD className="text-right tnum">{fmtNumber(totals.opportunities)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.customers)}</TD>
                  <TD className="text-right tnum">{fmtMoney(totals.revenue)}</TD>
                  <TD className="text-right tnum">{totals.cac === null ? '—' : fmtMoney(totals.cac)}</TD>
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
