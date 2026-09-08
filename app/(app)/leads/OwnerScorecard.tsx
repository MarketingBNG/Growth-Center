import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ownerScorecard } from '@/lib/scorecard';
import { thresholds } from '@/lib/settings';
import { fmtNumber, fmtPercent } from '@/lib/format';

// §7.5. "Serves Nafis and Nilesh as much as marketing, and ends the argument about
// whether lead quality or lead handling is the problem."
//
// That sentence is why the median quality column is here. A table of conversion rates
// without it settles the argument in marketing's favour by omission — and on this
// workspace's data the two explanations genuinely separate: one owner touched 86% of
// their leads and converted 0.4%, another touched none and converted 1.9%, on leads whose
// median quality differed by twenty-five points.

export async function OwnerScorecard({ window }: { window: { from: Date; to: Date } }) {
  const [rows, limits] = await Promise.all([ownerScorecard(window), thresholds()]);
  if (rows.length === 0) return null;

  const sla = limits['leads.slaHours'];

  return (
    <Card className="mt-[18px] overflow-hidden">
      <CardHeader>
        <CardTitle>Owner scorecard</CardTitle>
        <p className="text-xs text-muted-foreground">
          What each person received and what they did with it, over this period. Rates are
          against every lead received, not against the ones that were touched — excluding the
          untouched is what made the median response time look healthy while most leads had never
          been contacted at all.
        </p>
      </CardHeader>
      <TableWrap>
        <Table className="min-w-[780px]">
          <THead>
            <TR>
              <TH>Owner</TH>
              <TH className="text-right">Leads</TH>
              <TH className="text-right">Median quality</TH>
              <TH className="text-right">Untouched</TH>
              <TH className="text-right">Inside {sla}h</TH>
              <TH className="text-right">Semi-qualified</TH>
              <TH className="text-right">Converted</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.ownerEmail ?? 'unassigned'}>
                <TD className={r.ownerEmail ? 'font-medium' : 'font-medium text-muted-foreground'}>
                  {r.name}
                </TD>
                <TD className="text-right tnum">{fmtNumber(r.leads)}</TD>
                {/* The column that stops this being a table about people. A low
                    conversion rate on leads scoring 12 is a different problem from the
                    same rate on leads scoring 37, and it is not the same person's. */}
                <TD className="text-right tnum">{r.medianScore ?? '—'}</TD>
                <TD
                  className={`text-right tnum ${r.untouched > r.touched ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {fmtNumber(r.untouched)}
                </TD>
                <TD className="text-right tnum text-muted-foreground">
                  {r.slaRate === null ? '—' : fmtPercent(r.slaRate, 1)}
                </TD>
                <TD className="text-right tnum">
                  {r.semiQualifiedRate === null ? '—' : fmtPercent(r.semiQualifiedRate, 1)}
                </TD>
                <TD className="text-right tnum">
                  {r.convertedRate === null ? '—' : fmtPercent(r.convertedRate, 2)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <p className="border-t border-border px-4 py-2.5 text-meta text-muted-foreground">
        Median quality is the deterministic 0–100 score on the leads this person was handed. It is
        here because handling and quality are two explanations for the same low conversion rate,
        and the argument cannot be settled with only one of them on the row.
      </p>
    </Card>
  );
}
