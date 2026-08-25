import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { KpiCard } from '@/components/patterns/kpi-card';
import { LeadStatusBadge } from '@/components/patterns/badges';
import { NoDatabaseState } from '@/components/patterns/state';
import { TrendChart } from '@/components/charts/TrendChart';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { currentUser } from '@/lib/auth';
import { db, hasDb } from '@/lib/prisma';
import { funnel, kpis, openPipeline, rangeFor, trend, channelPerformance } from '@/lib/metrics';
import { campaignPerformance } from '@/lib/campaigns';
import { rangeParam } from '@/lib/range';
import { fmtMoney, fmtPercent, fmtRatio, fmtRelative, fmtNumber } from '@/lib/format';

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

  const [cards, f, pipeline, series, channels, campaigns, recentLeads, tasks, insights, demoIntegrations] =
    await Promise.all([
      kpis(days),
      funnel(current),
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
      db().integration.count({ where: { state: 'demo_data' } }),
    ]);

  const topCampaigns = campaigns.filter((c) => c.spend > 0 || c.revenue > 0).slice(0, 6);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${first}`}
        subtitle="What is happening with growth, why, and what to do next."
        actions={<RangePicker current={value} />}
      />

      {demoIntegrations > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs text-warning">
            These figures come from seeded demo data — no integration is connected.{' '}
            <Link href="/integrations" className="underline">
              Connect a source
            </Link>{' '}
            to replace it with live numbers.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 pb-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Revenue and spend share a unit, so they belong on one chart. Visitors and
              leads do not, so they get their own — never a second y-axis. */}
          <TrendChart
            title="Revenue and spend"
            subtitle={bucket === 'month' ? 'By month' : 'By day'}
            data={series}
            series={[
              { key: 'revenue', label: 'Revenue', kind: 'money' },
              { key: 'spend', label: 'Marketing spend', kind: 'money' },
            ]}
            height={220}
          />

          <div className="grid gap-4 sm:grid-cols-2">
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

          <Card className="overflow-hidden">
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
                    <TH className="text-right">Revenue</TH>
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
                      <TD className="text-right tnum">{c.spend ? fmtMoney(c.spend) : '—'}</TD>
                      <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                      <TD className="text-right tnum">{fmtNumber(c.customers)}</TD>
                      <TD className="text-right tnum">{c.revenue ? fmtMoney(c.revenue) : '—'}</TD>
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
                </TBody>
              </Table>
            </TableWrap>
          </Card>

          <Card className="overflow-hidden">
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
                      <TH className="text-right">Leads</TH>
                      <TH className="text-right">CPL</TH>
                      <TH className="text-right">Revenue</TH>
                      <TH className="text-right">ROAS</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {topCampaigns.map((c) => (
                      <TR key={c.id}>
                        <TD>
                          <span className="font-medium">{c.name}</span>
                          <p className="text-[11px] text-muted-foreground">{c.channelName}</p>
                        </TD>
                        <TD className="text-right tnum">{c.spend ? fmtMoney(c.spend) : '—'}</TD>
                        <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                        <TD className="text-right tnum text-muted-foreground">
                          {c.costPerLead === null ? '—' : fmtMoney(c.costPerLead)}
                        </TD>
                        <TD className="text-right tnum">{c.revenue ? fmtMoney(c.revenue) : '—'}</TD>
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
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <FunnelChart
            subtitle="Each step against the one above it"
            stages={[
              { key: 'visitors', label: 'Visitors', value: f.visitors },
              { key: 'leads', label: 'Leads', value: f.leads },
              { key: 'qualified', label: 'Qualified', value: f.qualified },
              { key: 'opportunities', label: 'Opportunities', value: f.opportunities },
              { key: 'customers', label: 'Customers', value: f.customers },
            ]}
          />

          <Card>
            <CardHeader>
              <CardTitle>Open pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row label="Deals" value={fmtNumber(pipeline.count)} />
              <Row label="Total value" value={fmtMoney(pipeline.total)} />
              <Row label="Weighted" value={fmtMoney(pipeline.weighted)} hint="By each deal's probability" />
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
                <p className="text-xs text-muted-foreground">No insights yet.</p>
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
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="pt-4 text-[11px] text-muted-foreground">
        Conversion: {fmtPercent(f.visitorToLead ?? 0, 2)} visitor → lead ·{' '}
        {fmtPercent(f.leadToQualified ?? 0)} lead → qualified ·{' '}
        {fmtPercent(f.opportunityToCustomer ?? 0)} opportunity → customer
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
