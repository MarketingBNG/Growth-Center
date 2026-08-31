import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { AddWidgetDrawer } from '@/components/patterns/add-widget-drawer';
import { AiAssistantCard } from '@/components/patterns/ai-assistant-card';
import { LeadStatusBadge, PriorityBadge } from '@/components/patterns/badges';
import { NoDatabaseState } from '@/components/patterns/state';
import { TrendChart } from '@/components/charts/TrendChart';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { TableCard } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { currentUser } from '@/lib/auth';
import { db, hasDb } from '@/lib/prisma';
import { openPipeline, rangeFor, trend, channelPerformance } from '@/lib/metrics';
import { dashboardBand } from '@/lib/band';
import { aiStatus } from '@/lib/ai';
import { campaignPerformance } from '@/lib/campaigns';
import { rangeParam } from '@/lib/range';
import { fmtDate, fmtMoney, fmtPercent, fmtRatio, fmtRelative, fmtNumber } from '@/lib/format';

export const metadata = { title: 'Dashboard · Growth Center' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const first = user?.name.split(' ')[0] ?? 'there';

  if (!hasDb()) {
    return (
      <>
        <PageHeader title={`Good to see you, ${first}`} subtitle="The command centre for BNG's growth engine." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days, bucket } = rangeParam(params);
  const { current } = rangeFor(days);

  const [dash, pipeline, series, channels, campaigns, recentLeads, tasks, insights] =
    await Promise.all([
      dashboardBand(days, bucket),
      openPipeline(),
      trend(current, bucket),
      channelPerformance(current),
      campaignPerformance(current),
      db().lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, firstName: true, lastName: true, companyName: true, status: true,
          createdAt: true, ownerEmail: true, channel: { select: { name: true } },
        },
      }),
      db().task.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        orderBy: { dueDate: 'asc' },
        take: 5,
        select: { id: true, title: true, dueDate: true, priority: true, assigneeEmail: true, leadId: true },
      }),
      db().aiInsight.findMany({
        where: { dismissedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, kind: true, title: true, body: true, provider: true },
      }),
    ]);

  const { band, funnel: f, visitorsFrom } = dash;

  // Money renders in the workspace's reporting currency, which the band already carries.
  // Aliased rather than passed at every call site: nine of them, and one missed would
  // print rupees with a dollar sign — the failure this whole change is about.
  const money = (n: number | null | undefined) => fmtMoney(n, false, band.currency);
  const ai = aiStatus();
  const topCampaigns = campaigns.filter((c) => c.spend > 0 || (c.revenue ?? 0) > 0).slice(0, 6);

  // Leads, CPL, new revenue and ROAS all hang off a campaignId that no lead, deal or
  // revenue row carries — Zoho records which CHANNEL a lead came from but never which ad,
  // so those four columns were structurally empty: 0, "—", ₹0, "—" on every row, for
  // every range. Four columns of nothing beside a real spend figure read as four
  // campaigns that sold nothing, which is a claim, not an absence.
  //
  // What Meta does report per campaign is delivery — impressions, clicks — and those are
  // on every one of the 2,008 spend rows. So the table shows what is known instead of
  // ruling columns for what is not.
  //
  // Tested rather than hard-coded, so the day anything stamps a campaign on a lead the
  // outcome columns come back on their own.
  const campaignsAttributed = topCampaigns.some((c) => (c.leads ?? 0) > 0 || (c.revenue ?? 0) > 0);

  // Semi-qualified is only its own step when something is actually sitting in it. The
  // stage counts leads that reached AT LEAST semi-qualified, so with no lead carrying
  // that status it equals Qualified exactly and the funnel draws the same number twice,
  // joined by a meaningless "100.0% of semi-qualified". Dropped when it is a duplicate
  // rather than deleted outright: the status is in the schema and the CRM may yet start
  // writing it, and this comes back on its own the day it does.
  const funnelStages = [
    {
      key: 'visitors',
      label: 'Visitors',
      value: f.visitors,
      // Said on the stage itself, because this is the number the two below it are being
      // measured against.
      hint: visitorsFrom
        ? `Sessions only go back to ${fmtDate(visitorsFrom)}; the stages below cover the whole period`
        : undefined,
    },
    {
      key: 'leads',
      label: 'Leads',
      value: f.leads,
      // Same reason the footer drops visitor → lead: over a period the sessions series
      // does not fully cover, leads over visitors is not a conversion rate.
      noRate: visitorsFrom !== null,
    },
    ...(f.semiQualified !== f.qualified
      ? [{ key: 'semiQualified', label: 'Semi-qualified', value: f.semiQualified }]
      : []),
    { key: 'qualified', label: 'Qualified', value: f.qualified },
    {
      key: 'opportunities',
      label: 'Opportunities',
      value: f.opportunities,
      // Checked against the live data rather than assumed: of 4,924 deals in the last
      // twelve months, 4,476 have no lead linked at all and the other 448 all came from
      // leads that did qualify. So the stage does not overtake Qualified because the flag
      // gets skipped — it overtakes because most deals are entered straight into Zoho
      // Deals and never existed as a lead.
      hint:
        f.opportunities > f.qualified
          ? 'More than qualified: most deals are created directly in the CRM and never existed as a lead'
          : undefined,
    },
    { key: 'customers', label: 'Customers', value: f.customers },
  ];

  return (
    <>
      <PageHeader
        title={`Good to see you, ${first}`}
        subtitle="What is happening with growth, why, and what to do next."
        actions={
          <>
            <RangePicker current={value} />
            <AddWidgetDrawer />
          </>
        }
      />

      {/* Provenance moved inside the band, where it is interactive: each source is a
          toggle that lifts the cards it feeds and dims the rest. It reads the sources
          off the cards themselves, so it cannot fall out of step with them the way a
          hand-written list above the numbers could. */}
      <MetricsBand {...band} />

      {/* 1.75fr / 1fr: the tables need the width, the summary cards do not.
          align-items:start so a short right column does not stretch its cards. */}
      <div className="grid items-start gap-3.5 lg:[grid-template-columns:minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Revenue and spend live in the band above; these two do not share a unit
              with it, or with each other, so they keep their own charts — never a
              second y-axis. */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <TrendChart
              title="Visitors"
              data={series}
              series={[{ key: 'visitors', label: 'Sessions', kind: 'number' }]}
              height={150}
            />
            <TrendChart
              title="Leads"
              data={series}
              series={[{ key: 'leads', label: 'Leads', kind: 'number' }]}
              height={150}
            />
          </div>

          <TableCard>
            <CardHeader>
              <CardTitle>Channel performance</CardTitle>
            </CardHeader>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Channel</TH>
                    <TH className="text-right">Spend</TH>
                    <TH className="text-right">Leads</TH>
                    <TH className="text-right">Customers</TH>
                    <TH className="text-right">New revenue</TH>
                    <TH className="text-right">CAC</TH>
                    <TH className="text-right">ROAS</TH>
                  </TR>
                </THead>
                <TBody>
                  {channels.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <span className="font-medium">{c.name}</span>
                        <span className="ml-1.5 text-[11px] text-muted-foreground">{c.kind}</span>
                      </TD>
                      <TD className="text-right tnum">{money(c.spend)}</TD>
                      <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
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
                </TBody>
              </Table>
            </TableWrap>
          </TableCard>

          <TableCard>
            <CardHeader>
              <CardTitle>Top campaigns</CardTitle>
            </CardHeader>
            {topCampaigns.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-muted-foreground">
                No campaign activity in this period.
              </p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Campaign</TH>
                      <TH className="text-right">Spend</TH>
                      {campaignsAttributed ? (
                        <>
                          <TH className="text-right">Leads</TH>
                          <TH className="text-right">CPL</TH>
                          <TH className="text-right">New revenue</TH>
                          <TH className="text-right">ROAS</TH>
                        </>
                      ) : (
                        <>
                          <TH className="text-right">Impressions</TH>
                          <TH className="text-right">Clicks</TH>
                          <TH className="text-right">CTR</TH>
                        </>
                      )}
                    </TR>
                  </THead>
                  <TBody>
                    {topCampaigns.map((c) => (
                      <TR key={c.id}>
                        <TD>
                          <span className="font-medium">{c.name}</span>
                          <p className="text-[11px] text-muted-foreground">{c.channelName}</p>
                        </TD>
                        <TD className="text-right tnum">{money(c.spend)}</TD>
                        {campaignsAttributed ? (
                          <>
                            <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                            <TD className="text-right tnum text-muted-foreground">
                              {c.costPerLead === null ? '—' : money(c.costPerLead)}
                            </TD>
                            <TD className="text-right tnum">{money(c.revenue)}</TD>
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
                        ) : (
                          <>
                            <TD className="text-right tnum">{fmtNumber(c.impressions)}</TD>
                            <TD className="text-right tnum">{fmtNumber(c.clicks)}</TD>
                            <TD className="text-right tnum text-muted-foreground">
                              {c.ctr === null ? '—' : fmtPercent(c.ctr, 2)}
                            </TD>
                          </>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
            {!campaignsAttributed && topCampaigns.length > 0 ? (
              <p className="px-5 pb-4 pt-1 text-[11px] text-muted-foreground">
                Delivery only. No lead or deal records which campaign it came from, so
                cost per lead and return cannot be attributed to a campaign yet.
              </p>
            ) : null}
          </TableCard>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <FunnelChart
            subtitle="Each step against the one above it"
            stages={funnelStages}
          />

          <Card>
            <CardHeader>
              <CardTitle>Open pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row label="Deals" value={fmtNumber(pipeline.count)} />
              <Row label="Total value" value={money(pipeline.total)} />
              <Row label="Weighted" value={money(pipeline.weighted)} hint="By each deal's probability" />
              <Link
                href="/pipeline"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open the board <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {insights.length === 0 ? (
                // "No insights yet" reads as "we looked and found nothing" when in fact
                // nothing has looked at all. The AI Assistant card at the foot of this
                // same column already names the missing key; this one stayed quiet about
                // it and the two disagreed about the same cause.
                <p className="text-xs text-muted-foreground">
                  {ai.configured
                    ? 'No insights yet.'
                    : 'Set ANTHROPIC_API_KEY to generate insights from your numbers.'}
                </p>
              ) : (
                insights.map((i) => (
                  <div key={i.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-snug">{i.title}</p>
                      {/* 'seed' means nobody analysed anything — say so rather than
                          letting an example read as a finding. */}
                      <Badge tone={i.provider === 'seed' ? 'warning' : 'purple'}>
                        {i.provider === 'seed' ? 'sample' : i.provider}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{i.body}</p>
                  </div>
                ))
              )}
              <Link href="/ai" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                All insights <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {recentLeads.length === 0 ? (
                <p className="text-xs text-muted-foreground">No leads yet.</p>
              ) : (
                recentLeads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-secondary/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {[l.firstName, l.lastName].filter(Boolean).join(' ')}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {l.companyName ?? l.channel?.name ?? 'No company'} · {fmtRelative(l.createdAt)}
                      </p>
                    </div>
                    <LeadStatusBadge status={l.status} />
                  </Link>
                ))
              )}
              <Link href="/leads" className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline">
                All leads <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasks needing attention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing open. </p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="flex items-start justify-between gap-2 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-xs">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.dueDate ? fmtRelative(t.dueDate) : 'No due date'}
                        {t.assigneeEmail ? ` · ${t.assigneeEmail.split('@')[0]}` : ''}
                      </p>
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <AiAssistantCard configured={ai.configured} />
        </div>
      </div>

      <p className="pt-4 text-[11px] text-muted-foreground">
        ROAS and CAC measure <span className="text-foreground">the paid channels only</span>: new
        business booked against a channel that carried spend, over that spend. Revenue that reached
        no channel, and customers who arrived another way, are real but they are not a return on
        advertising. Recurring income from customers won earlier is left out for the same reason.
      </p>
      <p className="pt-1 text-[11px] text-muted-foreground">
        Conversion:{' '}
        {/* Dropped rather than printed when sessions cover less of the period than leads
            do — leads over a shorter visitor series is not a conversion rate, and over
            twelve months it read as 251.13%. */}
        {visitorsFrom ? null : <>{fmtPercent(f.visitorToLead ?? 0, 2)} visitor → lead · </>}
        {fmtPercent(f.leadToQualified ?? 0)} lead → qualified ·{' '}
        {fmtPercent(f.opportunityToCustomer ?? 0)} opportunity → customer
        {visitorsFrom ? (
          <> · visitor → lead needs sessions from before {fmtDate(visitorsFrom)}</>
        ) : null}
      </p>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="block text-[10px]">{hint}</span> : null}
      </span>
      <span className="text-sm font-semibold tnum">{value}</span>
    </div>
  );
}
