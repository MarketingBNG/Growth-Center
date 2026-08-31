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
  // "Untouched" earned its own column, so Other is what is left after it.
  const columns = [...LEAD_STATES, { key: 'other', label: 'Other', hint: 'Every other status' } as const];

  return (
    <div className="space-y-4 pb-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leads" value={fmtNumber(data.leads)} sub={rangeLabel} />
        <Tile
          label="Converted"
          value={fmtNumber(data.converted)}
          // Said precisely, because the two numbers count different sets of leads: the
          // headline is every conversion recorded in this window, whenever the lead
          // arrived; the rate is how far this window's own arrivals have got.
          sub={
            data.conversionRate === null
              ? 'Conversions recorded in this window'
              : `${fmtPercent(data.conversionRate, 1)} of this window's own leads so far`
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

      {/* Lead status is five short bars and needs a fixed, modest width; the allocation
          table has eight columns and takes whatever is left. Splitting the row 1:2 left
          the Total column hanging off the right edge of its card. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* min-w-0 on both: a grid child defaults to min-width:auto, so the allocation
            table's own width became the card's floor and the card ran 190px past a phone
            screen, taking the whole page's horizontal scrollbar with it. The minmax(0,…)
            above only does this for the columns, which exist from lg up. */}
        <Card className="min-w-0">
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

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Lead allocation</CardTitle>
            <p className="text-xs text-muted-foreground">Who holds them, and what they marked</p>
          </CardHeader>
          <CardContent>
            {data.owners.length === 0 ? (
              <p className="text-xs text-muted-foreground">No leads in this window.</p>
            ) : (
              <TableWrap>
                {/* Eight columns in a half-width card: the shared 20px cell padding alone
                    came to 320px and pushed Total out past the scroll edge, where nobody
                    would look for it. Tightened here rather than in the shared table,
                    which is right for the full-width lists. */}
                <Table className="[&_td]:px-2 [&_th]:px-2">
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
                          {/* The local part, as every other owner column on the site shows
                              it. Sixteen full addresses at @usaindiacfo.com pushed the
                              table past the card: Untouched was clipped mid-word and the
                              Total column — the one the eye goes to first — was off the
                              right edge entirely. The full address stays in the title. */}
                          <Link href={leadsHref(o.owner)} className="hover:underline" title={o.owner}>
                            {o.owner.includes('@') ? o.owner.split('@')[0] : o.owner}
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
