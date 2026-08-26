import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { campaignPerformance, campaignTotals } from '@/lib/campaigns';
import { rangeFor } from '@/lib/metrics';
import { rangeParam } from '@/lib/range';
import { cards } from '@/lib/integrations/service';
import { fmtMoney, fmtNumber, fmtPercent, fmtRatio, fmtRelative } from '@/lib/format';

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
  const { current } = rangeFor(days);

  const [all, providers] = await Promise.all([campaignPerformance(current), cards()]);

  const rows = all.filter((r) => r.channelKind === 'paid' || r.channelKind === 'social');
  const active = rows.filter((r) => r.spend > 0);
  const totals = campaignTotals(active);

  const adProviders = providers.filter((p) => p.category === 'ads' || p.category === 'social');
  const live = adProviders.filter((p) => p.state === 'connected' || p.state === 'syncing');
  // A campaign with no `source` was written by the seeder, not reported by a platform.
  const seeded = active.filter((r) => !r.source);

  return (
    <>
      <PageHeader
        title="Paid Ads"
        subtitle="Spend and return across ad platforms."
        actions={<RangePicker current={value} />}
      />

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
            <p className="text-[11px] text-muted-foreground">
              Every figure below is seeded. Connect a platform on the Integrations page to replace
              it with reported spend.
            </p>
          </CardHeader>
        </Card>
      ) : seeded.length > 0 ? (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>Mixed sources</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {seeded.length} of {active.length} campaigns below were seeded rather than reported by
              a platform, so the totals blend real and demo spend.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Spend" value={fmtMoney(totals.spend)} />
        <Stat label="Impressions" value={fmtNumber(totals.impressions)} />
        <Stat
          label="Clicks"
          value={fmtNumber(totals.clicks)}
          sub={`${fmtPercent(totals.ctr ?? 0, 2)} CTR`}
        />
        <Stat
          label="Cost per lead"
          value={totals.costPerLead === null ? '—' : fmtMoney(totals.costPerLead)}
          sub={`${fmtNumber(totals.leads)} leads`}
        />
        <Stat label="ROAS" value={totals.roas === null ? '—' : fmtRatio(totals.roas)} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Only campaigns with spend in this period. A dash means nothing has been attributed yet,
            not zero.
          </p>
        </CardHeader>

        {active.length === 0 ? (
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
                  <TH>Campaign</TH>
                  <TH>Platform</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Impressions</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">CTR</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">CPL</TH>
                  <TH className="text-right">ROAS</TH>
                </TR>
              </THead>
              <TBody>
                {active.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">
                      {r.name}
                      {!r.source ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          seeded
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">{r.channelName}</TD>
                    <TD className="text-right tnum">{fmtMoney(r.spend)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {fmtNumber(r.impressions)}
                    </TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(r.clicks)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {fmtPercent(r.ctr ?? 0, 2)}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(r.leads)}</TD>
                    <TD className="text-right tnum">
                      {r.costPerLead === null ? '—' : fmtMoney(r.costPerLead)}
                    </TD>
                    <TD className="text-right tnum">{r.roas === null ? '—' : fmtRatio(r.roas)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p className="pt-1 text-xl font-bold tracking-tight tnum">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
