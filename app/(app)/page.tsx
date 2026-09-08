import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { MetricsBand } from '@/components/patterns/metrics-band';
import { AiAssistantCard } from '@/components/patterns/ai-assistant-card';
import { LeadStatusBadge } from '@/components/patterns/badges';
import { NoDatabaseState } from '@/components/patterns/state';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { TableCard } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { currentUser } from '@/lib/auth';
import { db, hasDb } from '@/lib/prisma';
import { openPipeline, windowFor, channelPerformance } from '@/lib/metrics';
import { dashboardBand } from '@/lib/band';
import { aiStatus } from '@/lib/ai';
import { bucketFor, customRange, rangeParam } from '@/lib/range';
import { fmtDate, fmtMoney, fmtPercent, fmtRatio, fmtRelative, fmtNumber } from '@/lib/format';
import { WEB_LEAD_BASIS } from '@/lib/web-leads';
import { segmentMix } from '@/lib/leads';
import { deliveryCapacity } from '@/lib/capacity';
import { CostPerConsultation } from './CostPerConsultation';
import { ActionQueue } from './ActionQueue';
import { isPartnerView } from '@/lib/partner-view';
import {
  PartnerHidden,
  PartnerViewProvider,
  PartnerViewSubtitle,
  PartnerViewToggle,
} from './PartnerView';

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
  // §6.6's preset, read from the URL so the screen a partner sees is a link somebody can
  // send rather than a setting somebody has to remember to switch back.
  const partnerView = isPartnerView(params);
  const { value, days, bucket: presetBucket } = rangeParam(params);
  // A hand-picked window from the calendar wins over the preset. The two are the same
  // setting — RangePicker clears one when the other is chosen — so this only has to say
  // which it prefers when both somehow appear in a URL.
  const picked = customRange(params);
  const spec = picked ?? days;
  const bucket = picked ? bucketFor(picked.days) : presetBucket;
  const { current } = windowFor(spec);

  const [dash, pipeline, channels, segments, capacity, recentLeads] =
    await Promise.all([
      dashboardBand(spec, bucket),
      openPipeline(),
      channelPerformance(current),
      // §7.4: "Lead mix by segment renders on the dashboard."
      segmentMix(current),
      // §6.2: "Marketing must not create consultations the firm cannot serve. The ceiling
      // belongs on the same screen as the accelerator."
      deliveryCapacity(),
      db().lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, firstName: true, lastName: true, companyName: true, status: true,
          createdAt: true, ownerEmail: true, channel: { select: { name: true } },
        },
      }),
    ]);

  const { band, funnel: f, visitorsFrom } = dash;

  // Money renders in the workspace's reporting currency, which the band already carries.
  // Aliased rather than passed at every call site: nine of them, and one missed would
  // print rupees with a dollar sign — the failure this whole change is about.
  const money = (n: number | null | undefined) => fmtMoney(n, false, band.currency);
  const ai = aiStatus();

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
    // The param seeds it; from then on the toggle is a client concern. See PartnerView.
    <PartnerViewProvider initial={partnerView}>
      <PageHeader
        title={`Good to see you, ${first}`}
        subtitle={
          <PartnerViewSubtitle plain="What is happening with growth, why, and what to do next." />
        }
        actions={
          <>
            <RangePicker current={value} />
            {/* §6.6. Partners open this screen; they should see performance, not
                individual staff scorecards. */}
            <PartnerViewToggle />
            {/* §6.3 still holds — the queue is the first thing on the morning screen and
                sits above the numbers. It is a counted button rather than a card because
                as a card it filled the whole opening screen and pushed the first figure
                below the fold, and most mornings this page is opened to read figures. The
                count, red when anything critical is open, is what announces it; the panel
                is there when the count says to look. */}
            <ActionQueue />
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
          {/* Three charts used to sit here — visitors, leads and marketing spend — and each
              was already drawn somewhere it belonged: sessions and ad spend on Analytics,
              leads created on Leads, all off the same series. The revenue trend in the
              band above is this page's own, and stays. */}

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
                        <span className="ml-1.5 text-meta text-muted-foreground">{c.kind}</span>
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
              {/* §9.5. Both figures, because a forecast that fell for unstated reasons
                  is one nobody trusts — and the gap between them is the cost of the
                  silence, which is the number worth acting on. */}
              <Row
                label="Weighted"
                value={money(pipeline.weighted)}
                hint="By each deal's probability, reduced for silence"
              />
              {pipeline.decayingDeals > 0 ? (
                <Row
                  label="Lost to silence"
                  value={money(pipeline.undecayedWeighted - pipeline.weighted)}
                  hint={`${fmtNumber(pipeline.decayingDeals)} of ${fmtNumber(pipeline.count)} deals have gone quiet`}
                />
              ) : null}
              <Link
                href="/pipeline"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open the board <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>


          {/* §6.1's other half. "A blended number cannot be acted on. Nobody can buy
              blended." */}
          <CostPerConsultation range={current} currency={dash.funnel.currency} />

          {/* §6.2. Load is measured and the ceiling is entered, and the card says which
              half is which — a ceiling inferred from headcount would be an invented
              number on the one screen whose whole purpose is to stop marketing
              outrunning delivery. */}
          <Card>
            <CardHeader>
              <CardTitle>Delivery capacity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row
                label="Consultations this month"
                value={fmtNumber(capacity.booked)}
                hint="Deals opened. This CRM records no consultation event — the same gap that leaves CPQL without a numerator."
              />
              {capacity.ceiling === null ? (
                <p className="pt-1 text-meta text-muted-foreground">
                  No monthly ceiling has been set, so there is nothing to measure this against.
                  A default would be a number nobody chose being used to authorise spending.
                  Set one in Settings.
                </p>
              ) : (
                <>
                  <Row
                    label="Ceiling"
                    value={fmtNumber(capacity.ceiling)}
                    hint={
                      capacity.ceilingSetBy
                        ? `Set by ${capacity.ceilingSetBy.split('@')[0]}`
                        : 'Entered by hand'
                    }
                  />
                  <Row
                    label="Used"
                    value={fmtPercent(capacity.utilisation ?? 0, 0)}
                    hint={capacity.over ? 'Over the ceiling — stop adding demand' : undefined}
                  />
                </>
              )}
              <Row
                label="Open delivery work"
                value={fmtNumber(capacity.openDeliveryTasks)}
                hint={`Across ${fmtNumber(capacity.deliveryPeople)} people, from Zoho Projects`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lead mix by segment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {segments.total === 0 ? (
                <p className="text-xs text-muted-foreground">No leads in this period.</p>
              ) : (
                <>
                  {segments.rows.map((r) => (
                    <div
                      key={r.segment ?? 'unsegmented'}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className={r.segment ? 'truncate' : 'truncate text-muted-foreground'}>
                        {r.label}
                      </span>
                      <span className="shrink-0 tnum text-muted-foreground">
                        {fmtNumber(r.leads)} · {fmtPercent(r.share, 1)}
                      </span>
                    </div>
                  ))}
                  {/* The qualification, not a footnote. Four fifths of these leads arrived
                      through a chat thread that asked them nothing, and a five-way split
                      over the remaining fifth reads as the whole picture unless the page
                      says how much of it is missing. */}
                  <p className="pt-1 text-meta text-muted-foreground">
                    {fmtNumber(segments.known)} of {fmtNumber(segments.total)} leads said what
                    kind of business they are. The rest came through channels that never asked.
                  </p>
                </>
              )}
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
                      <p className="truncate text-meta text-muted-foreground">
                        {l.companyName ?? l.channel?.name ?? 'No company'} · {fmtRelative(l.createdAt)}
                        {l.ownerEmail ? (
                          <PartnerHidden> · {l.ownerEmail.split('@')[0]}</PartnerHidden>
                        ) : null}
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


          <AiAssistantCard configured={ai.configured} />
        </div>
      </div>

      <p className="pt-4 text-meta text-muted-foreground">
        ROAS and CAC measure <span className="text-foreground">the paid channels only</span>: new
        business booked against a channel that carried spend, over that spend. Revenue that reached
        no channel, and customers who arrived another way, are real but they are not a return on
        advertising. Recurring income from customers won earlier is left out for the same reason.
      </p>
      <p className="pt-1 text-meta text-muted-foreground">
        Conversion:{' '}
        {/* Dropped rather than printed when sessions cover less of the period than leads
            do — leads over a shorter visitor series is not a conversion rate, and over
            twelve months it read as 251.13%. */}
        {/* §16: the numerator is the leads that arrived through the site, not all of
            them. Blended it divided 15,830 leads — 12,614 filled on Meta, LinkedIn or
            WhatsApp without loading a page — by the website's sessions, and rose whenever
            the website's traffic fell. */}
        {visitorsFrom ? null : (
          <>
            <span title={WEB_LEAD_BASIS}>{fmtPercent(f.visitorToLead ?? 0, 2)} visitor → lead</span>{' '}
            ({fmtNumber(f.webLeads)} of {fmtNumber(f.leads)} leads came through the site) ·{' '}
          </>
        )}
        {fmtPercent(f.leadToQualified ?? 0)} lead → qualified ·{' '}
        {fmtPercent(f.opportunityToCustomer ?? 0)} opportunity → customer
        {visitorsFrom ? (
          <> · visitor → lead needs sessions from before {fmtDate(visitorsFrom)}</>
        ) : null}
      </p>
    </PartnerViewProvider>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="block text-micro">{hint}</span> : null}
      </span>
      <span className="text-sm font-semibold tnum">{value}</span>
    </div>
  );
}
