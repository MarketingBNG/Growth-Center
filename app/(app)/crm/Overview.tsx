import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LEAD_STATES, type CrmOverview } from '@/lib/crm-overview';
import { fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';

/**
 * The lead-flow half of the CRM screen: what came in, what the owners marked it as, and
 * what came out.
 *
 * Statuses are the CRM's own — SQ, Follow-up, CNR, Dead — not the app's shared vocabulary,
 * which collapses the last three into `contacted` and `lost` and would make the table
 * unreadable to the people who set them.
 */
export function Overview({
  data,
  rangeLabel,
  window,
}: {
  data: CrmOverview;
  rangeLabel: string;
  /** The resolved window, so an owner's row can open exactly the leads it counted. */
  window: { from: Date; to: Date };
}) {
  const money = (n: number) => fmtMoney(n, false, data.currency);

  // The allocation table answers "how many"; this link answers "which ones". Same window
  // and same owner, so the list cannot disagree with the number that led to it.
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const leadsHref = (owner: string) =>
    `/leads?ownerEmail=${encodeURIComponent(owner === 'Unassigned' ? 'unassigned' : owner)}` +
    `&from=${day(window.from)}&to=${day(window.to)}`;
  const columns = [...LEAD_STATES, { key: 'other', label: 'Other', hint: 'Untouched or unclassified' } as const];

  return (
    <div className="space-y-4 pb-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leads" value={fmtNumber(data.leads)} sub={rangeLabel} />
        <Tile
          label="Converted"
          value={fmtNumber(data.converted)}
          sub={
            data.conversionRate === null
              ? 'No leads to convert'
              : `${fmtPercent(data.conversionRate, 1)} of leads`
          }
        />
        <Tile label="Deals created" value={fmtNumber(data.dealsCreated)} sub="Opened in this window" />
        <Tile
          label="Revenue"
          value={money(data.revenue)}
          // Named precisely: the CRM knows what a deal was worth, not what was collected.
          sub={`Value of ${fmtNumber(data.dealsWon)} deals won`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Lead status</CardTitle>
            <p className="text-xs text-muted-foreground">As the owners marked them</p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {columns.map((s) => {
              const count = data.statuses[s.key];
              const share = data.leads ? (count / data.leads) * 100 : 0;
              return (
                <div key={s.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      {s.label}
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{s.hint}</span>
                    </span>
                    <span className="tnum text-xs font-semibold">{fmtNumber(count)}</span>
                  </div>
                  {/* A bar rather than a pie: five categories read faster in one column,
                      and the eye compares lengths better than angles. */}
                  <div className="mt-1 h-1.5 w-full rounded-full bg-secondary">
                    <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead allocation</CardTitle>
            <p className="text-xs text-muted-foreground">Who holds them, and what they marked</p>
          </CardHeader>
          <CardContent>
            {data.owners.length === 0 ? (
              <p className="text-xs text-muted-foreground">No leads in this window.</p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Owner</TH>
                      {columns.map((s) => (
                        <TH key={s.key} className="text-right">
                          {s.label}
                        </TH>
                      ))}
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.owners.map((o) => (
                      <TR key={o.owner}>
                        <TD className="whitespace-nowrap">
                          <Link href={leadsHref(o.owner)} className="hover:underline">
                            {o.owner}
                          </Link>
                        </TD>
                        {columns.map((s) => (
                          <TD key={s.key} className="text-right tnum">
                            {o.counts[s.key] || <span className="text-muted-foreground">—</span>}
                          </TD>
                        ))}
                        <TD className="text-right tnum font-semibold">{fmtNumber(o.total)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
