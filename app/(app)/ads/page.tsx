import Link from 'next/link';
import { ArrowRight, Megaphone } from 'lucide-react';
import { StatTile } from '@/components/patterns/stat-tile';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { campaignPerformance, campaignTotals } from '@/lib/campaigns';
import { costPer, rate } from '@/lib/calc';
import { provenance, windowFor } from '@/lib/metrics';
import { customRange, rangeParam } from '@/lib/range';
import { cards } from '@/lib/integrations/service';
import { fmtMoney, fmtNumber, fmtPercent, fmtRatio, fmtRelative } from '@/lib/format';
import { currencySettings } from '@/lib/settings';
import { SourceLine } from '@/components/patterns/source-badge';

export const metadata = { title: 'Paid Ads · Growth Center' };

// Was a "not built yet" placeholder while the data it promised was already in the
// database and already rendered on Marketing. This is the paid slice of the same
// campaign rows: Marketing covers every channel, this one covers money out.
export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Paid Ads" subtitle="Spend and return across ad platforms." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days } = rangeParam(params);
  // A hand-picked window from the calendar wins over the preset. The two are the same
  // setting — RangePicker clears one when the other is chosen — so this only has to say
  // which it prefers when both somehow appear in a URL.
  const picked = customRange(params);
  const { current } = windowFor(picked ?? days);

  const [all, providers, sources] = await Promise.all([
    campaignPerformance(current),
    cards(),
    provenance(current),
  ]);

  const rows = all.filter((r) => r.channelKind === 'paid' || r.channelKind === 'social');
  const active = rows.filter((r) => r.spend > 0);
  const totals = campaignTotals(active);

  // No metrics band on this page, so the reporting currency is read directly. Spend here
  // is billed in the ad account's currency and converted upstream; the symbol has to
  // match what the figure now is.
  const fx = await currencySettings();
  const money = (n: number | null | undefined) => fmtMoney(n, false, fx.reporting);


  const adProviders = providers.filter((p) => p.category === 'ads' || p.category === 'social');
  const live = adProviders.filter((p) => p.state === 'connected' || p.state === 'syncing');
  // A campaign with no `source` was written by the seeder, not reported by a platform.
  const seeded = active.filter((r) => !r.source);

  // Whether anything downstream of a click is attributed to a campaign. Zoho stamps a
  // channel on a lead but never a campaign, so leads, CPL and ROAS come back null from
  // campaignPerformance rather than 0 — three columns of dashes beside a real spend
  // figure, which is the same empty table with quieter punctuation. Marketing already
  // drops them on this test; Paid Ads kept them, and they pushed ROAS off the edge of
  // the card. Derived from the data, so they return the day something stamps a campaign.
  const attributed = active.some((r) => r.leads !== null || r.revenue !== null);

  /**
   * Rolled up by platform, which is what this page is for.
   *
   * The campaign rows that used to be here were the same rows Marketing shows, minus
   * four of its columns — and Marketing has to keep them, because §6.4's hiring filter,
   * its totals and its "show hiring" link are all built on that table. So the duplicate
   * is this one, and deleting it outright would have left the page with nothing but its
   * five tiles.
   *
   * A platform view is the thing neither page had. "Spend and return across ad
   * platforms" is what the subtitle promises, and until now the only way to answer it was
   * to read a campaign list and add up the rows in your head.
   *
   * Ratios are recomputed from each platform's totals rather than averaged down its
   * campaigns, for the reason the footer already gives: an average of ratios disagrees
   * with the ratio of the totals.
   */
  const platforms = [...
    active
      .reduce((acc, r) => {
        const key = r.channelName ?? 'Unattributed';
        const at = acc.get(key) ?? { name: key, campaigns: 0, spend: 0, impressions: 0, clicks: 0 };
        at.campaigns += 1;
        at.spend += r.spend ?? 0;
        at.impressions += r.impressions ?? 0;
        at.clicks += r.clicks ?? 0;
        acc.set(key, at);
        return acc;
      }, new Map<string, { name: string; campaigns: number; spend: number; impressions: number; clicks: number }>())
      .values(),
  ]
    .map((p) => ({
      ...p,
      // Through lib/calc's `rate`, not by hand: it returns percentage units, which is
      // what fmtPercent here expects. Divided raw, Meta Ads read 0.00% CTR beside a
      // total of 0.37% computed from the same two numbers.
      ctr: rate(p.clicks, p.impressions),
      cpc: p.clicks > 0 ? p.spend / p.clicks : null,
      cpm: p.impressions > 0 ? (p.spend / p.impressions) * 1000 : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  // What the platform does bill on, for the two tiles the outcome metrics cannot fill.
  const cpc = costPer(totals.spend, totals.clicks);
  const cpm = totals.impressions ? (totals.spend / totals.impressions) * 1000 : null;

  return (
    <>
      <PageHeader
        title="Paid Ads"
        subtitle="Spend and return across ad platforms."
        actions={<RangePicker current={value} />}
      />

      <SourceLine items={[{ label: 'Spend', sources: sources.spend }]} />

      <div className="mb-4 flex flex-wrap gap-2">
        {adProviders.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
          >
            <span className="font-medium">{p.name}</span>
            <Badge
              tone={
                p.state === 'connected' ? 'success' : p.state === 'demo_data' ? 'warning' : 'neutral'
              }
            >
              {p.state === 'demo_data' ? 'seeded' : p.state}
            </Badge>
            {p.lastSyncAt ? (
              <span className="text-muted-foreground">{fmtRelative(p.lastSyncAt)}</span>
            ) : null}
          </span>
        ))}
      </div>

      {live.length === 0 ? (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>No ad platform is connected</CardTitle>
            <p className="text-meta text-muted-foreground">
              Every figure below is seeded. Connect a platform on the Integrations page to replace
              it with reported spend.
            </p>
          </CardHeader>
        </Card>
      ) : seeded.length > 0 ? (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>Mixed sources</CardTitle>
            <p className="text-meta text-muted-foreground">
              {seeded.length} of {active.length} campaigns below were seeded rather than reported by
              a platform, so the totals blend real and demo spend.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Spend" value={money(totals.spend)} />
        <StatTile label="Impressions" value={fmtNumber(totals.impressions)} />
        <StatTile
          label="Clicks"
          value={fmtNumber(totals.clicks)}
          sub={totals.ctr === null ? undefined : `${fmtPercent(totals.ctr, 2)} CTR`}
        />
        {/* Cost per lead and ROAS are the tiles this page wants, but nothing stamps a
            campaign on a lead or a payment, so both were headline em dashes on every
            range. Until something does, the two slots show what Meta actually bills —
            cost per click and per thousand impressions — and swap back on their own. */}
        {attributed ? (
          <>
            <StatTile
              label="Cost per lead"
              value={totals.costPerLead === null ? '—' : money(totals.costPerLead)}
              sub={`${fmtNumber(totals.leads)} leads`}
            />
            <StatTile label="ROAS" value={totals.roas === null ? '—' : fmtRatio(totals.roas)} />
          </>
        ) : (
          <>
            <StatTile
              label="Cost per click"
              value={cpc === null ? '—' : fmtMoney(cpc, true, fx.reporting)}
            />
            <StatTile label="Cost per 1,000 impr." value={cpm === null ? '—' : money(cpm)} />
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Platforms</CardTitle>
            <p className="text-meta text-muted-foreground">
              Delivery per platform over this period. Cost per click and per thousand
              impressions are computed from each platform&rsquo;s own totals.
            </p>
          </div>
          {/* The campaign rows live on Marketing, which carries the hiring filter and the
              attribution columns. Said out loud so nobody looks for them here. */}
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/marketing">
              Campaign detail <ArrowRight className="size-3" />
            </Link>
          </Button>
        </CardHeader>

        {platforms.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-6" />}
            title="No paid spend in this period"
            hint="Widen the range, or connect an ad platform on the Integrations page."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Platform</TH>
                  <TH className="text-right">Campaigns</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Impressions</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">CTR</TH>
                  <TH className="text-right">CPC</TH>
                  <TH className="text-right">CPM</TH>
                </TR>
              </THead>
              <TBody>
                {platforms.map((p) => (
                  <TR key={p.name}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {fmtNumber(p.campaigns)}
                    </TD>
                    <TD className="text-right tnum">{money(p.spend)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {fmtNumber(p.impressions)}
                    </TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(p.clicks)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {p.ctr === null ? '—' : fmtPercent(p.ctr, 2)}
                    </TD>
                    <TD className="text-right tnum">
                      {p.cpc === null ? '—' : fmtMoney(p.cpc, true, fx.reporting)}
                    </TD>
                    <TD className="text-right tnum">{p.cpm === null ? '—' : money(p.cpm)}</TD>
                  </TR>
                ))}
                {/* Ratios recomputed from the totals rather than averaged down the rows,
                    which is how a footer ends up disagreeing with its own columns. */}
                <TR className="border-t-2 border-border font-semibold hover:bg-transparent">
                  <TD>Total</TD>
                  <TD className="text-right tnum">{fmtNumber(active.length)}</TD>
                  <TD className="text-right tnum">{money(totals.spend)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.impressions)}</TD>
                  <TD className="text-right tnum">{fmtNumber(totals.clicks)}</TD>
                  <TD className="text-right tnum">
                    {totals.ctr === null ? '—' : fmtPercent(totals.ctr, 2)}
                  </TD>
                  <TD className="text-right tnum">
                    {cpc === null ? '—' : fmtMoney(cpc, true, fx.reporting)}
                  </TD>
                  <TD className="text-right tnum">{cpm === null ? '—' : money(cpm)}</TD>
                </TR>
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

