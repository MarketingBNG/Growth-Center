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
import { fmtMoney, fmtMoneyCompact, fmtNumber, fmtPercent, fmtRatio } from '@/lib/format';
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
    // Only channels that actually hold a campaign. Every channel in the workspace was
    // offered before, and eleven of the twelve had nothing to show: clicking one swapped
    // the table for "No campaign activity", which reads as a broken page rather than as
    // an empty channel.
    db().channel.findMany({
      where: { campaigns: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    campaignPerformance(current, channelId),
    marketingBand(days, bucket, channelId),
  ]);

  // Money renders in the workspace's reporting currency. Aliased so a call site cannot
  // silently fall back to dollars, which is how rupees came to be printed with a $.
  const money = (n: number | null | undefined) => fmtMoney(n, false, band.currency);

  // Which sources actually appear in this period, so the filter never offers an option
  // that would return nothing.
  const hasActivity = (r: (typeof rows)[number]) =>
    r.spend > 0 || (r.leads ?? 0) > 0 || (r.revenue ?? 0) > 0;

  const presentSources = [...new Set(rows.filter(hasActivity).map((r) => r.source ?? DEMO_SOURCE))].map((id) => ({
    id,
    name: sourceMeta(id).name,
  }));

  const filtered = source ? rows.filter((r) => (r.source ?? DEMO_SOURCE) === source) : rows;

  // Unattributed is a real row and belongs in a table, but it is not a channel, and as a
  // bar it was nine times the largest real one — every channel the chart exists to compare
  // rendered as the same one-pixel sliver. Split out and stated in the subtitle instead of
  // dropped, so the money is still accounted for.
  // The channel filter now scopes the band and the trend as well as the table, so the
  // page describes one channel rather than showing its campaigns under the whole
  // business's headline numbers — blended, a ROAS of 225x sat above a table of Meta
  // campaigns that had earned none of it.
  //
  // The source filter deliberately does not reach them: a lead, deal or payment carries
  // no integration source, so there is nothing to scope a funnel by. It narrows the
  // campaign table only, and the note under the band says which figures moved.
  const withRevenue = channels.filter((c) => c.revenue > 0);
  const unattributed = withRevenue.find((c) => c.id === 'unattributed')?.revenue ?? 0;
  const named = withRevenue.filter((c) => c.id !== 'unattributed');

  const totals = campaignTotals(filtered);
  const active = filtered.filter(hasActivity);

  // Whether anything downstream of a click is attributed to a campaign. Zoho stamps a
  // CHANNEL on a lead but never a campaign — Campaign_Source is null on all 27,256 — so
  // Leads, CPL, Deals, Cust., New revenue, CAC and ROAS cannot be computed per campaign,
  // and campaignPerformance returns null for them rather than 0.
  //
  // Seven columns of dashes beside a real spend figure is not better than seven columns
  // of zeroes; it is the same empty table with quieter punctuation. So the table shows
  // what Meta does report per campaign — delivery — and says once, above it, why the rest
  // is missing. The dashboard's campaign table already does this.
  //
  // Derived from the data, so the outcome columns come back on their own the day anything
  // starts stamping a campaign on a lead.
  const attributed = active.some((c) => c.leads !== null || c.revenue !== null);

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

      {channelId || source ? (
        <p className="-mt-2 pb-3 text-[11px] text-muted-foreground">
          {channelId
            ? `Every figure on this page covers ${allChannels.find((c) => c.id === channelId)?.name ?? 'this channel'} only.`
            : null}
          {channelId && source ? ' ' : null}
          {source
            ? 'The source filter narrows the campaign table alone — leads, deals and payments carry no integration source to scope the rest by.'
            : null}
        </p>
      ) : null}

      {/* A chart that compares channels answers nothing once you have picked one, and a
          single bar next to an axis is a worse way to read one number than the band above
          it already is. */}
      {channelId ? null : (
        <div className="pb-[18px]">
          <BarChart
            title="Revenue by channel"
            subtitle={
              unattributed > 0
                ? `${fmtMoneyCompact(unattributed, band.currency)} reached no channel and is not plotted`
                : undefined
            }
            data={named.map((c) => ({ label: c.name, value: c.revenue }))}
            kind="money"
            // Without this the axis labelled rupees with a dollar sign, while every other
            // figure on the page was already in the workspace's own currency.
            currency={band.currency}
          />
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
          {active.length > 0 && !attributed ? (
            <p className="text-[11px] text-muted-foreground">
              Delivery only. The CRM records which channel a lead came from but never which
              campaign, so leads, CPL, deals, revenue, CAC and ROAS cannot be attributed to a
              campaign here — they would be blank on every row rather than zero.
            </p>
          ) : null}
        </CardHeader>
        {active.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-6" />}
            title="No campaign activity in this period"
            hint="Widen the date range, or connect Meta Ads and Google Ads to pull spend automatically."
          />
        ) : (
          <TableWrap>
            <Table className={attributed ? 'min-w-[1180px]' : 'min-w-[760px]'}>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Channel</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Impr.</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">CTR</TH>
                  {attributed ? (
                    <>
                      <TH className="text-right">Leads</TH>
                      <TH className="text-right">CPL</TH>
                      <TH className="text-right">Deals</TH>
                      <TH className="text-right">Cust.</TH>
                      <TH className="text-right">New revenue</TH>
                      <TH className="text-right">CAC</TH>
                      <TH className="text-right">ROAS</TH>
                    </>
                  ) : null}
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
                    {attributed ? (
                      <>
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
                      </>
                    ) : null}
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
                  {attributed ? (
                    <>
                      <TD className="text-right tnum">{fmtNumber(totals.leads)}</TD>
                      <TD className="text-right tnum">
                        {totals.costPerLead === null ? '—' : money(totals.costPerLead)}
                      </TD>
                      <TD className="text-right tnum">{fmtNumber(totals.opportunities)}</TD>
                      <TD className="text-right tnum">{fmtNumber(totals.customers)}</TD>
                      <TD className="text-right tnum">{money(totals.revenue)}</TD>
                      <TD className="text-right tnum">{totals.cac === null ? '—' : money(totals.cac)}</TD>
                      <TD className="text-right tnum">{totals.roas === null ? '—' : fmtRatio(totals.roas)}</TD>
                    </>
                  ) : null}
                </TR>
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
