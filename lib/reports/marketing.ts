import { campaignPerformance, campaignTotals } from '../campaigns.ts';
import { int, pct, ratio, type ReportContext, type Section } from './shared.ts';

export async function marketing({ current, money }: ReportContext): Promise<Section[]> {
  const rows = await campaignPerformance(current);
  const totals = campaignTotals(rows);
  const active = rows.filter((r) => r.spend > 0 || (r.leads ?? 0) > 0);
  return [
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
  ];
}
