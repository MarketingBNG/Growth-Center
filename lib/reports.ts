import { db } from './prisma.ts';
import { OPEN_DEAL } from './pipeline.ts';
import { convert, symbolOf, type CurrencySettings } from './currency.ts';
import { currencySettings } from './settings.ts';
import { channelPerformance, funnel, openPipeline, windowFor, type Range } from './metrics.ts';
import { campaignPerformance, campaignTotals } from './campaigns.ts';
import { leadSourceLabel } from './integrations/crm-mapping.ts';
import { fairShare } from './calc.ts';
import { insightHealth } from './insight-health.ts';

// Reports are compositions of the SAME functions the pages use. Nothing here recomputes
// a metric its own way, which is what stops an exported report from disagreeing with the
// dashboard it was run from.

export const REPORTS = [
  {
    id: 'executive',
    name: 'Executive growth report',
    description: 'The funnel, revenue against spend, and where growth came from.',
  },
  {
    id: 'marketing',
    name: 'Marketing report',
    description: 'Campaign and channel performance with CAC and ROAS.',
  },
  {
    id: 'leads',
    name: 'Lead report',
    description: 'Volume, sources and qualification, plus who owns what.',
  },
  {
    id: 'lead-flow',
    name: 'Lead flow',
    description: 'Whether the daily lead flow is landing evenly across the team.',
  },
  {
    id: 'sales',
    name: 'Sales report',
    description: 'Pipeline by stage, deals won and lost, and revenue booked.',
  },
  {
    id: 'revenue-by-partner',
    name: 'Revenue by partner',
    description: 'Who closed the revenue, who referred it, and where it came from.',
  },
  {
    id: 'attribution',
    name: 'Revenue attribution',
    description: 'Revenue traced back to the channel and campaign that produced it.',
  },
] as const;

export type ReportId = (typeof REPORTS)[number]['id'];
export const isReportId = (v: string): v is ReportId => REPORTS.some((r) => r.id === v);

export type Section =
  | { kind: 'stats'; title: string; rows: { label: string; value: string; hint?: string }[] }
  | { kind: 'table'; title: string; columns: string[]; align?: ('left' | 'right')[]; rows: string[][] }
  | { kind: 'note'; title: string; body: string };

export type Report = { id: ReportId; name: string; range: Range; sections: Section[] };

/** The reporting currency's symbol, not a dollar sign: this workspace reports in rupees
 *  and its ad spend is billed in them. */
const moneyIn = (settings: CurrencySettings) => (n: number | null) =>
  n === null ? '—' : `${symbolOf(settings.reporting)}${Math.round(n).toLocaleString('en-US')}`;
const int = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
const pct = (n: number | null, d = 1) => (n === null ? '—' : `${n.toFixed(d)}%`);
const ratio = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)}×`);

export async function buildReport(id: ReportId, spec: number | Range): Promise<Report> {
  const { current, previous } = windowFor(spec);
  const name = REPORTS.find((r) => r.id === id)!.name;
  const base = { id, name, range: current };

  // Deals and revenue here are written in more than one currency, so every figure below
  // converts before it adds. Summed flat, 143 rupee deals were counted as dollars.
  const fx = await currencySettings();
  const money = moneyIn(fx);
  const inFx = (amount: unknown, currency: string | null) =>
    convert(Number(amount ?? 0), currency, fx) ?? 0;

  if (id === 'executive') {
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
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Funnel',
          rows: [
            { label: 'Visitors', value: int(now.visitors) },
            { label: 'Leads', value: int(now.leads), hint: `${pct(now.visitorToLead, 2)} of visitors` },
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
      ],
    };
  }

  if (id === 'marketing') {
    const rows = await campaignPerformance(current);
    const totals = campaignTotals(rows);
    const active = rows.filter((r) => r.spend > 0 || (r.leads ?? 0) > 0);
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Totals',
          rows: [
            { label: 'Spend', value: money(totals.spend) },
            { label: 'Impressions', value: int(totals.impressions) },
            { label: 'Clicks', value: int(totals.clicks), hint: `${pct(totals.ctr, 2)} CTR` },
            { label: 'Leads', value: int(totals.leads), hint: totals.costPerLead === null ? undefined : `${money(totals.costPerLead)} per lead` },
            { label: 'Revenue', value: money(totals.revenue), hint: `${ratio(totals.roas)} ROAS` },
          ],
        },
        {
          kind: 'table',
          title: 'Campaigns',
          columns: ['Campaign', 'Channel', 'Spend', 'Clicks', 'CTR', 'Leads', 'CPL', 'New revenue', 'ROAS'],
          align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
          rows: active.map((c) => [
            c.name, c.channelName, money(c.spend), int(c.clicks), pct(c.ctr, 2),
            int(c.leads), c.costPerLead === null ? '—' : money(c.costPerLead),
            money(c.revenue), ratio(c.roas),
          ]),
        },
      ],
    };
  }

  if (id === 'leads') {
    const window = { gte: current.from, lte: current.to };
    const [byStatus, bySource, byOwner, total, qualified] = await Promise.all([
      db().lead.groupBy({ by: ['status'], where: { createdAt: window }, _count: { _all: true } }),
      // By the CRM's own source, not the SourceType enum. Grouped by the enum, this table
      // reported "social 17,989" — one row for Facebook, Instagram, LinkedIn and WhatsApp
      // together — while every other screen in the app named the four separately.
      db().lead.groupBy({ by: ['sourceDetail'], where: { createdAt: window }, _count: { _all: true } }),
      db().lead.groupBy({ by: ['ownerEmail'], where: { createdAt: window }, _count: { _all: true } }),
      db().lead.count({ where: { createdAt: window } }),
      db().lead.count({ where: { createdAt: window, qualifiedAt: { not: null } } }),
    ]);
    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Volume',
          rows: [
            { label: 'Leads created', value: int(total) },
            { label: 'Reached qualified', value: int(qualified), hint: total ? `${((qualified / total) * 100).toFixed(1)}% of new leads` : undefined },
          ],
        },
        {
          kind: 'table',
          title: 'By status',
          columns: ['Status', 'Leads', 'Share'],
          align: ['left', 'right', 'right'],
          rows: byStatus.map((r) => [r.status, int(r._count._all), total ? `${((r._count._all / total) * 100).toFixed(1)}%` : '—']),
        },
        {
          kind: 'table',
          title: 'By source',
          columns: ['Source', 'Leads'],
          align: ['left', 'right'],
          // Folded onto the same groups the Leads page filters by, busiest first, so a
          // report and the screen it came from cannot disagree about how many leads
          // Facebook produced.
          rows: [...bySource
            .reduce((acc, r) => {
              const label = leadSourceLabel(r.sourceDetail);
              return acc.set(label, (acc.get(label) ?? 0) + r._count._all);
            }, new Map<string, number>())]
            .sort((a, b) => b[1] - a[1])
            .map(([label, n]) => [label, int(n)]),
        },
        {
          kind: 'table',
          title: 'By owner',
          columns: ['Owner', 'Leads'],
          align: ['left', 'right'],
          rows: byOwner.map((r) => [r.ownerEmail ?? 'Unassigned', int(r._count._all)]),
        },
      ],
    };
  }

  if (id === 'lead-flow') {
    // "So that everyone gets a fair lead flow every day. That should be the target in the
    // process." — the Sep 2 review. This is that target, measured.
    //
    // Read-only, and deliberately. Every one of this workspace's 27,401 leads arrives from
    // Zoho with an owner already on it — nothing is created here — so round-robin
    // assignment in this app would have nothing to assign and would fight the sync for the
    // records it does touch. The lever is Zoho's own assignment rules; what was missing was
    // any way to see whether they are landing evenly.
    const rows = await db().lead.findMany({
      where: { createdAt: { gte: current.from, lte: current.to } },
      select: { ownerEmail: true, createdAt: true },
    });

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const days = new Set(rows.map((r) => iso(r.createdAt)));
    const byOwner = new Map<string, { n: number; days: Set<string> }>();
    for (const r of rows) {
      const key = r.ownerEmail ?? 'Unassigned';
      const acc = byOwner.get(key) ?? { n: 0, days: new Set<string>() };
      acc.n += 1;
      acc.days.add(iso(r.createdAt));
      byOwner.set(key, acc);
    }

    // The target is an even split across everyone who took a lead, over the days leads
    // arrived — not across the calendar, which would read every quiet weekend as a
    // shortfall, and not across the whole roster, most of whom do not work leads.
    const dayCount = days.size || 1;
    const { target, ranked, topSkew } = fairShare(
      [...byOwner]
        .filter(([name]) => name !== 'Unassigned')
        .map(([name, { n, days: active }]) => ({ name, leads: n, activeDays: active.size })),
      rows.length,
      dayCount,
    );
    const owners = ranked;

    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'The daily target',
          rows: [
            { label: 'Leads in period', value: int(rows.length), hint: `over ${dayCount} days that produced any` },
            { label: 'People taking leads', value: int(owners.length) },
            {
              label: 'Even share, per person per day',
              value: target.toFixed(1),
              hint: `The target: ${int(rows.length)} leads split evenly across ${owners.length} people over ${dayCount} days`,
            },
            {
              label: 'Busiest person',
              value: `${topSkew.toFixed(1)}× even share`,
              hint:
                topSkew >= 1.5
                  ? 'The flow is uneven — see who is over and under below'
                  : 'Reasonably even across the team',
            },
          ],
        },
        {
          kind: 'table',
          title: 'Against the target',
          columns: ['Owner', 'Leads', 'Per day', 'Days active', 'Share', 'vs target'],
          align: ['left', 'right', 'right', 'right', 'right', 'right'],
          rows: ranked.map((r) => [
            r.name,
            int(r.leads),
            r.perDay.toFixed(1),
            `${r.activeDays}/${dayCount}`,
            pct(r.share),
            // Signed, so over and under read at a glance rather than needing the target
            // held in your head.
            `${r.vsTarget >= 0 ? '+' : ''}${r.vsTarget.toFixed(0)}%`,
          ]),
        },
        {
          kind: 'note',
          title: 'How to act on this',
          body:
            'Leads are assigned in Zoho before they reach Growth Center, so this report measures ' +
            'the outcome rather than setting it. To change the split, adjust the assignment rules ' +
            'in Zoho CRM; this report will show the effect from the next sync onward.',
        },
      ],
    };
  }

  if (id === 'sales') {
    const window = { gte: current.from, lte: current.to };
    const [stages, won, lost, revenue, pipeline] = await Promise.all([
      db().pipelineStage.findMany({
        orderBy: { position: 'asc' },
        include: { opportunities: { where: OPEN_DEAL, select: { value: true, probability: true, currency: true } } },
      }),
      db().opportunity.findMany({ where: { closedAt: window, stage: { isWon: true } }, select: { value: true, currency: true } }),
      db().opportunity.findMany({ where: { closedAt: window, stage: { isLost: true } }, select: { value: true, currency: true, lostReason: true } }),
      db().revenueEntry.groupBy({ by: ['currency'], where: { date: window }, _sum: { amount: true } }),
      openPipeline(),
    ]);

    const lostReasons = lost.reduce<Record<string, number>>((acc, o) => {
      const key = o.lostReason ?? 'Not recorded';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Closed in period',
          rows: [
            { label: 'Won', value: int(won.length), hint: money(won.reduce((t, o) => t + inFx(o.value, o.currency), 0)) },
            { label: 'Lost', value: int(lost.length), hint: money(lost.reduce((t, o) => t + inFx(o.value, o.currency), 0)) },
            { label: 'Win rate', value: won.length + lost.length ? `${((won.length / (won.length + lost.length)) * 100).toFixed(0)}%` : '—' },
            { label: 'Revenue booked', value: money(revenue.reduce((t, r) => t + inFx(r._sum.amount, r.currency), 0)) },
            { label: 'Open pipeline', value: money(pipeline.total), hint: `${money(pipeline.weighted)} weighted` },
          ],
        },
        {
          kind: 'table',
          title: 'Open pipeline by stage',
          columns: ['Stage', 'Deals', 'Value', 'Weighted'],
          align: ['left', 'right', 'right', 'right'],
          rows: stages
            .filter((s) => !s.isWon && !s.isLost)
            .map((s) => {
              const value = s.opportunities.reduce((t, o) => t + inFx(o.value, o.currency), 0);
              const weighted = s.opportunities.reduce(
                (t, o) => t + (inFx(o.value, o.currency) * o.probability) / 100,
                0,
              );
              return [s.name, int(s.opportunities.length), money(value), money(weighted)];
            }),
        },
        {
          kind: 'table',
          title: 'Why deals were lost',
          columns: ['Reason', 'Deals'],
          align: ['left', 'right'],
          rows: Object.entries(lostReasons).map(([reason, count]) => [reason, int(count)]),
        },
      ],
    };
  }

  if (id === 'revenue-by-partner') {
    // Revenue reaches a person only through a deal: every revenue_entry carries an
    // opportunityId and is derived from a won one. So both breakdowns below start there —
    // the owner is on the deal, and the referring partner is on the source string of the
    // deal or of the lead behind it.
    const rows = await db().revenueEntry.findMany({
      where: { date: { gte: current.from, lte: current.to } },
      select: {
        amount: true,
        currency: true,
        channelId: true,
        opportunity: {
          select: {
            ownerEmail: true,
            sourceDetail: true,
            lead: { select: { sourceDetail: true } },
          },
        },
      },
    });

    const total = rows.reduce((t, r) => t + inFx(r.amount, r.currency), 0);
    const share = (n: number) => (total ? pct((n / total) * 100) : '—');

    /** Sums into a map, converting to the reporting currency first. */
    const tally = (keyOf: (r: (typeof rows)[number]) => string | null) => {
      const out = new Map<string, { amount: number; deals: number }>();
      for (const r of rows) {
        const key = keyOf(r);
        if (key === null) continue;
        const acc = out.get(key) ?? { amount: 0, deals: 0 };
        acc.amount += inFx(r.amount, r.currency);
        acc.deals += 1;
        out.set(key, acc);
      }
      return [...out].sort((a, b) => b[1].amount - a[1].amount);
    };

    const byOwner = tally((r) => r.opportunity?.ownerEmail ?? 'Unassigned');

    // The lead's source first, then the deal's — the same precedence revenue itself uses
    // to pick a channel, so a partner's revenue here matches their channel's there.
    const sourceOf = (r: (typeof rows)[number]) =>
      r.opportunity?.lead?.sourceDetail ?? r.opportunity?.sourceDetail ?? null;

    // Only the sources that name a referrer. "Reference", "Client Ref", "Ref by NG" —
    // leadSourceGroup calls all of these `referral`, which is the point: this splits them
    // back apart into who actually sent the business.
    const byReferrer = tally((r) => {
      const s = sourceOf(r);
      if (!s) return null;
      return /\bref\b|refer/i.test(s) ? s : null;
    });
    const referralTotal = byReferrer.reduce((t, [, v]) => t + v.amount, 0);

    const bySource = tally((r) => leadSourceLabel(sourceOf(r)));
    const attributed = rows.filter((r) => r.channelId !== null);
    const attributedTotal = attributed.reduce((t, r) => t + inFx(r.amount, r.currency), 0);

    return {
      ...base,
      sections: [
        {
          kind: 'stats',
          title: 'Revenue in period',
          rows: [
            { label: 'Total', value: money(total), hint: `${int(rows.length)} payments, all from won deals` },
            { label: 'People with revenue', value: int(byOwner.length) },
            {
              label: 'Referred by a partner',
              value: money(referralTotal),
              hint: total ? `${share(referralTotal)} of revenue, across ${byReferrer.length} referrers` : undefined,
            },
            {
              label: 'Traceable to a source',
              value: money(attributedTotal),
              hint: `${share(attributedTotal)} — the rest reaches no channel, see the note below`,
            },
          ],
        },
        {
          kind: 'table',
          title: 'By deal owner',
          columns: ['Owner', 'Deals', 'Revenue', 'Share'],
          align: ['left', 'right', 'right', 'right'],
          rows: byOwner.map(([name, v]) => [name, int(v.deals), money(v.amount), share(v.amount)]),
        },
        {
          kind: 'table',
          title: 'By referring partner',
          columns: ['Referred by', 'Deals', 'Revenue', 'Share'],
          align: ['left', 'right', 'right', 'right'],
          rows: byReferrer.length
            ? byReferrer.map(([name, v]) => [name, int(v.deals), money(v.amount), share(v.amount)])
            : [['No referred revenue in this period', '—', '—', '—']],
        },
        {
          kind: 'table',
          title: 'By source',
          columns: ['Source', 'Deals', 'Revenue', 'Share'],
          align: ['left', 'right', 'right', 'right'],
          rows: bySource.map(([name, v]) => [name, int(v.deals), money(v.amount), share(v.amount)]),
        },
        {
          kind: 'note',
          title: 'How far the source is knowable',
          body:
            `${share(attributedTotal)} of this revenue can be traced to a channel. The rest cannot: ` +
            'Zoho links only a minority of won deals back to the lead that produced them, so most ' +
            'payments arrive with no source of any kind. Those are counted in the total and shown as ' +
            'Unattributed rather than spread across the sources that can be identified — splitting ' +
            'them would inflate every channel in proportion to how well it already reports.',
        },
      ],
    };
  }

  // attribution
  const window = { gte: current.from, lte: current.to };
  const [byChannel, byCampaign, direct] = await Promise.all([
    db().revenueEntry.groupBy({ by: ['channelId', 'currency'], where: { date: window }, _sum: { amount: true }, _count: { _all: true } }),
    db().revenueEntry.groupBy({ by: ['campaignId', 'currency'], where: { date: window }, _sum: { amount: true } }),
    db().revenueEntry.groupBy({ by: ['currency'], where: { date: window, channelId: null }, _sum: { amount: true } }),
  ]);

  const [channels, campaigns] = await Promise.all([
    db().channel.findMany({ select: { id: true, name: true } }),
    db().campaign.findMany({ select: { id: true, name: true } }),
  ]);
  const channelName = new Map(channels.map((c) => [c.id, c.name]));
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  // Grouping by currency splits each channel and campaign into a row per currency, so
  // they are folded back once every amount is in the reporting one. Without this a
  // channel that billed in both would appear twice and its share would be halved.
  const fold = <T extends { _sum: { amount: unknown }; currency: string | null }>(
    rows: T[],
    keyOf: (row: T) => string,
  ) => {
    const out = new Map<string, { key: string; amount: number; entries: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const acc = out.get(key) ?? { key, amount: 0, entries: 0 };
      acc.amount += inFx(row._sum.amount, row.currency);
      acc.entries += (row as { _count?: { _all: number } })._count?._all ?? 0;
      out.set(key, acc);
    }
    return [...out.values()].sort((a, b) => b.amount - a.amount);
  };

  const channelRevenue = fold(byChannel, (r) => r.channelId ?? '');
  const campaignRevenue = fold(byCampaign, (r) => r.campaignId ?? '');
  const totalRevenue = channelRevenue.reduce((t, r) => t + r.amount, 0);

  return {
    ...base,
    sections: [
      {
        kind: 'note',
        title: 'How this is attributed',
        body: 'Every revenue row carries the channel and campaign of the lead that produced it, captured at conversion. Revenue with no channel came from a deal created directly, without an originating lead.',
      },
      {
        kind: 'table',
        title: 'Revenue by channel',
        columns: ['Channel', 'Entries', 'Revenue', 'Share'],
        align: ['left', 'right', 'right', 'right'],
        rows: channelRevenue.map((r) => [
          r.key ? (channelName.get(r.key) ?? 'Unknown') : 'No channel recorded',
          int(r.entries),
          money(r.amount),
          totalRevenue ? `${((r.amount / totalRevenue) * 100).toFixed(1)}%` : '—',
        ]),
      },
      {
        kind: 'table',
        title: 'Revenue by campaign',
        columns: ['Campaign', 'Revenue'],
        align: ['left', 'right'],
        rows: campaignRevenue
          .filter((r) => r.amount > 0)
          .map((r) => [
            r.key ? (campaignName.get(r.key) ?? 'Unknown') : 'No campaign recorded',
            money(r.amount),
          ]),
      },
      {
        kind: 'stats',
        title: 'Unattributed',
        rows: [
          {
            label: 'Revenue with no channel',
            value: money(direct.reduce((t, r) => t + inFx(r._sum.amount, r.currency), 0)),
          },
        ],
      },
    ],
  };
}
