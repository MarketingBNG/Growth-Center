import { channelPerformance, funnel, openPipeline } from '../metrics.ts';
import { WEB_LEAD_BASIS } from '../analytics/web-leads.ts';
import { insightHealth } from '../insights/insight-health.ts';
import { int, pct, ratio, type ReportContext, type Section } from './shared.ts';

export async function executive({ current, previous, money }: ReportContext): Promise<Section[]> {
  const [now, before, pipeline, channels, health] = await Promise.all([
    funnel(current),
    funnel(previous),
    openPipeline(),
    channelPerformance(current),
    // §21.6 puts these on the weekly pack rather than on a screen, and the reason is
    // that they are about the process, not the business: nobody opens a dashboard to
    // check whether their own queue is being worked.
    insightHealth(current.from, current.to),
  ]);
  return [
    {
      kind: 'stats',
      title: 'Funnel',
      rows: [
        { label: 'Visitors', value: int(now.visitors) },
        { label: 'Leads', value: int(now.leads) },
        // §16: the rate belongs to the leads that came through the site, not to every
        // lead. Hung off its own row rather than the Leads row's hint, because
        // "x% of visitors" under a count of all leads is the claim being retired.
        {
          label: 'Leads from the website',
          value: int(now.webLeads),
          hint: `${pct(now.visitorToLead, 2)} of visitors. ${WEB_LEAD_BASIS}`,
        },
        { label: 'Qualified leads', value: int(now.qualified), hint: `${pct(now.leadToQualified)} of leads` },
        { label: 'Opportunities', value: int(now.opportunities) },
        { label: 'New customers', value: int(now.customers), hint: `${pct(now.opportunityToCustomer)} of opportunities` },
      ],
    },
    {
      kind: 'stats',
      title: 'Money',
      rows: [
        { label: 'Revenue', value: money(now.revenue), hint: `all bookings; ${money(before.revenue)} previous period` },
        {
          label: 'New business',
          value: money(now.newRevenue),
          hint: 'first engagement with an account, read from the deal name',
        },
        {
          label: 'Repeat business',
          value: money(now.repeatRevenue),
          hint: 'further work for an account already on the books',
        },
        // Named rather than left as the gap between the three figures. A quarter of
        // the deals carry no naming convention, and a reader who adds the two cards
        // above and finds they miss the revenue line deserves the reason on the page.
        ...(now.unclassifiedRevenue > 0
          ? [
              {
                label: 'Unclassified',
                value: money(now.unclassifiedRevenue),
                hint: 'deals whose name says neither new nor repeat',
              },
            ]
          : []),
        { label: 'Marketing spend', value: money(now.spend), hint: `${money(before.spend)} previous period` },
        { label: 'CAC', value: now.cac === null ? '—' : money(now.cac) },
        { label: 'ROAS', value: ratio(now.roas) },
        { label: 'Open pipeline', value: money(pipeline.total), hint: `${money(pipeline.weighted)} weighted` },
      ],
    },
    {
      kind: 'table',
      title: 'Channels',
      columns: ['Channel', 'Spend', 'Leads', 'Customers', 'New revenue', 'ROAS'],
      align: ['left', 'right', 'right', 'right', 'right', 'right'],
      rows: channels.map((c) => [c.name, money(c.spend), int(c.leads), int(c.customers), money(c.revenue), ratio(c.roas)]),
    },
    {
      kind: 'table',
      title: 'Insight engine health',
      columns: ['Measure', 'Now', 'Healthy', 'If it drifts'],
      align: ['left', 'right', 'left', 'left'],
      // A metric with no figure prints why, in the value column, instead of a dash
      // that reads as zero. The deferral rate is permanently in that state until
      // claim checks exist, and §21.6 says a zero there is a defect — so it must
      // never be shown as one.
      rows: health.metrics.map((m) => [
        m.label,
        m.value === null
          ? 'Not measured'
          : m.format === 'percent'
            ? pct(m.value)
            : `${m.value}h`,
        m.healthy,
        m.unavailable ?? m.basis ?? m.drift,
      ]),
    },
    {
      kind: 'note',
      title: 'What these four numbers are for',
      body: `${health.open} findings are open. The rates above describe how the queue is being worked, not how the business is doing: a closure rate that falls means the queue is producing work nobody does, and a dismissal rate near zero means findings are being waved through rather than judged.`,
    },
  ];
}
