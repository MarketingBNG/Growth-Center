import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { channelPerformance } from '@/lib/metrics';
import { lostReasonMix, segmentMix } from '@/lib/leads';
import { fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';
import { currencySettings } from '@/lib/settings';

// §7.1, §7.4 and §7.6 in one band under the leads table.
//
// The three belong together because they answer one question between them — what kind of
// leads are we buying, at what price, and why do we lose them — and the manual's
// complaint about each is the same complaint: a single blended figure was standing in for
// a distribution.

export async function LeadQuality({ window }: { window: { from: Date; to: Date } }) {
  const [channels, segments, lost, money] = await Promise.all([
    channelPerformance(window),
    segmentMix(window),
    lostReasonMix(window),
    currencySettings(),
  ]);

  const cost = (n: number | null) => (n === null ? '—' : fmtMoney(n, false, money.reporting));

  // Only the channels that did something in the period. A table of fifteen rows, eleven
  // of them zeroes, is a worse answer than four rows.
  const active = channels.filter((c) => c.spend > 0 || c.leads > 0);

  return (
    <div className="mt-[18px] grid gap-3.5 lg:grid-cols-2">
      <Card className="overflow-hidden lg:col-span-2">
        <CardHeader>
          <CardTitle>Cost per lead by channel</CardTitle>
          <p className="text-xs text-muted-foreground">
            The blended cost per lead has been taken off the card row above: it divided
            all paid spend by all leads however they arrived, most of them referrals and
            inbound, so it read as the price of a paid lead and was not. Nobody can buy
            blended. Spend excludes the recruitment campaigns — see the note on Marketing.
          </p>
        </CardHeader>
        {active.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            No channel recorded spend or leads in this period.
          </p>
        ) : (
          <TableWrap>
            <Table className="min-w-[560px]">
              <THead>
                <TR>
                  <TH>Channel</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Acquisition spend</TH>
                  <TH className="text-right">CPL</TH>
                  <TH className="text-right">Customers</TH>
                  <TH className="text-right">CAC</TH>
                </TR>
              </THead>
              <TBody>
                {active.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.name}</TD>
                    <TD className="text-right tnum">{fmtNumber(c.leads)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {c.acquisitionSpend > 0 ? cost(c.acquisitionSpend) : '—'}
                    </TD>
                    {/* An em-dash, never ₹0. Untracked spend is unknown, not free —
                        divided directly, every organic channel claimed its leads cost
                        nothing to acquire. */}
                    <TD className="text-right tnum">{cost(c.costPerLead)}</TD>
                    <TD className="text-right tnum">{fmtNumber(c.customers)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{cost(c.cac)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Lead mix by segment</CardTitle>
          <p className="text-xs text-muted-foreground">
            Read from the answer each person gave on the lead form rather than guessed
            from a name. {fmtNumber(segments.known)} of {fmtNumber(segments.total)} leads said
            what kind of business they are; the rest arrived through a chat thread that never
            asked.
          </p>
        </CardHeader>
        <TableWrap>
          <Table className="min-w-[420px]">
            <THead>
              <TR>
                <TH>Segment</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Share</TH>
                <TH className="text-right">Median quality</TH>
              </TR>
            </THead>
            <TBody>
              {segments.rows.map((r) => (
                <TR key={r.segment ?? 'unsegmented'}>
                  <TD className={r.segment ? 'font-medium' : 'text-muted-foreground'}>{r.label}</TD>
                  <TD className="text-right tnum">{fmtNumber(r.leads)}</TD>
                  <TD className="text-right tnum text-muted-foreground">{fmtPercent(r.share, 1)}</TD>
                  {/* The number §7.3 exists to make possible: a segmented lead averages
                      three times an unsegmented one, which is the discrimination that
                      lets "this campaign's leads got worse" be said before the
                      conversions show it. */}
                  <TD className="text-right tnum">{r.meanScore === null ? '—' : r.meanScore}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Why leads were lost</CardTitle>
          <p className="text-xs text-muted-foreground">
            Read from the CRM&rsquo;s own status word. Shares are of the losses that give
            a reason, not of all losses — measured over the whole set, &ldquo;no reason
            given&rdquo; would be reported as the firm&rsquo;s main reason for losing, which is
            true and useless.
          </p>
        </CardHeader>
        {lost.total === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            No leads were closed lost in this period.
          </p>
        ) : (
          <TableWrap>
            <Table className="min-w-[380px]">
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Share of stated</TH>
                </TR>
              </THead>
              <TBody>
                {lost.rows.map((r) => (
                  <TR key={r.reason ?? 'none'}>
                    <TD className={r.reason === 'unstated' ? 'text-muted-foreground' : 'font-medium'}>
                      {r.label}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(r.leads)}</TD>
                    <TD className="text-right tnum text-muted-foreground">
                      {r.share === null ? '—' : fmtPercent(r.share, 1)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
