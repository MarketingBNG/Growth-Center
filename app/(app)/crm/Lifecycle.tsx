import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProgressLink } from '@/components/NavProgress';
import { accountValueDistribution, clientLifecycle, FLAG_LABELS } from '@/lib/lifecycle';
import { referralPartners } from '@/lib/referrals';
import { fmtDate, fmtMoney, fmtNumber, fmtRelative } from '@/lib/format';
import { PartnerRegistry } from './PartnerRegistry';

// §8.2, §8.3 and §8.5 on one tab.
//
// They belong together: what a client is worth, what has been asked of them, and who sent
// them. The manual's argument for all three is the same one — "renewal and referral are
// the cheapest revenue in the firm and currently have no system of record anywhere."

const ENGAGEMENT_LABELS: Record<string, string> = {
  one_time: 'One-off',
  retainer: 'Retainer',
  unclassified: 'No convention in the deal name',
};

export async function Lifecycle({ canManage }: { canManage: boolean }) {
  const [lifecycle, value, partners] = await Promise.all([
    clientLifecycle(),
    accountValueDistribution(),
    referralPartners(),
  ]);

  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, false, value.currency));

  return (
    <div className="space-y-[18px]">
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>What an account is worth</CardTitle>
            <p className="text-xs text-muted-foreground">
              The average moves with one engagement; the median says what a client is
              actually worth.
            </p>
          </CardHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-3 text-xs sm:grid-cols-4">
            <Figure label="Median" value={money(value.median)} strong />
            <Figure label="Mean" value={money(value.mean)} />
            <Figure label="Lower quartile" value={money(value.p25)} />
            <Figure label="Upper quartile" value={money(value.p75)} />
          </div>
          {value.meanOverMedian && value.meanOverMedian > 1.5 ? (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              {/* The manual's 347% complaint, restated as the ratio it actually is. */}
              The mean is {value.meanOverMedian.toFixed(1)}× the median, so it describes no
              account that exists. {value.outliers.length} account
              {value.outliers.length === 1 ? '' : 's'} sit above{' '}
              <span className="tnum">{money(value.outlierFence ?? null)}</span> — more than one and a
              half interquartile ranges past the upper quartile, which is where an account stops
              being large and starts distorting the average.
            </p>
          ) : null}
          {value.outliers.length > 0 ? (
            <ul className="border-t border-border px-4 py-2.5 text-xs">
              {value.outliers.slice(0, 4).map((o) => (
                <li key={o.id} className="flex justify-between gap-3 py-0.5">
                  <span className="truncate text-muted-foreground">{o.name}</span>
                  <span className="shrink-0 tnum">{money(o.value)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Engagements and lifecycle debt</CardTitle>
            <p className="text-xs text-muted-foreground">
              The one-off / retainer split is read from the deal-name suffixes the firm
              already writes — it has been in the data all along and nothing had grouped by it.
            </p>
          </CardHeader>
          <TableWrap>
            <Table className="min-w-[380px]">
              <THead>
                <TR>
                  <TH>Engagement</TH>
                  <TH className="text-right">Clients</TH>
                  <TH className="text-right">Lifetime value</TH>
                </TR>
              </THead>
              <TBody>
                {lifecycle.byEngagement.map((row) => (
                  <TR key={row.type}>
                    <TD className={row.type === 'unclassified' ? 'text-muted-foreground' : 'font-medium'}>
                      {ENGAGEMENT_LABELS[row.type] ?? row.type}
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(row.customers)}</TD>
                    <TD className="text-right tnum">{money(row.value)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ul className="border-t border-border px-4 py-2.5 text-xs">
            {lifecycle.flags.map((f) => (
              <li key={f.flag} className="flex justify-between gap-3 py-0.5">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="tnum">{fmtNumber(f.customers)} clients</span>
              </li>
            ))}
          </ul>
          {/* Said plainly rather than left to be inferred from four identical counts. */}
          <p className="border-t border-border px-4 py-2.5 text-meta text-muted-foreground">
            Nothing infers these from activity: a logged call is not evidence that a referral was
            asked for. They read as never-done until somebody records the ask, which is what makes
            them worth acting on rather than worth arguing with.
          </p>
        </Card>
      </div>

      {lifecycle.upcoming.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Anniversaries inside a month</CardTitle>
            <p className="text-xs text-muted-foreground">
              The clients worth a call this month, with what is outstanding on each.
            </p>
          </CardHeader>
          <TableWrap>
            <Table className="min-w-[620px]">
              <THead>
                <TR>
                  <TH>Client</TH>
                  <TH className="text-right">Years</TH>
                  <TH className="text-right">Anniversary</TH>
                  <TH className="text-right">Lifetime value</TH>
                  <TH>Outstanding</TH>
                </TR>
              </THead>
              <TBody>
                {lifecycle.upcoming.slice(0, 15).map((row) => (
                  <TR key={row.customerId}>
                    <TD className="font-medium">
                      <ProgressLink href={`/crm/companies/${row.companyId}`} className="hover:text-primary">
                        {row.company}
                      </ProgressLink>
                    </TD>
                    <TD className="text-right tnum">{row.years}</TD>
                    <TD className="text-right text-muted-foreground">
                      {row.daysToAnniversary === 0 ? 'today' : `in ${row.daysToAnniversary} days`}
                    </TD>
                    <TD className="text-right tnum">{money(row.lifetimeValue)}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {row.flags.length === 0
                        ? 'Nothing outstanding'
                        : row.flags.map((f) => FLAG_LABELS[f]).join(' · ')}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Clients with the most outstanding</CardTitle>
          <p className="text-xs text-muted-foreground">
            Sorted by how many lifecycle touches are unlit, then by what the account is worth —
            the client with four and the largest balance is the one worth the call.
          </p>
        </CardHeader>
        <TableWrap>
          <Table className="min-w-[620px]">
            <THead>
              <TR>
                <TH>Client</TH>
                <TH>Engagement</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Renewal</TH>
                <TH className="text-right">Lifetime value</TH>
                <TH>Outstanding</TH>
              </TR>
            </THead>
            <TBody>
              {lifecycle.rows.slice(0, 20).map((row) => (
                <TR key={row.customerId}>
                  <TD className="font-medium">
                    <ProgressLink href={`/crm/companies/${row.companyId}`} className="hover:text-primary">
                      {row.company}
                    </ProgressLink>
                  </TD>
                  <TD className="text-muted-foreground">
                    {ENGAGEMENT_LABELS[row.engagementType ?? 'unclassified']}
                  </TD>
                  <TD className="text-right text-muted-foreground">{fmtRelative(row.wonAt)}</TD>
                  <TD className="text-right text-muted-foreground">
                    {row.renewalDueAt ? fmtDate(row.renewalDueAt) : '—'}
                  </TD>
                  <TD className="text-right tnum">{money(row.lifetimeValue)}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {row.flags.length === 0 ? '—' : row.flags.map((f) => FLAG_LABELS[f]).join(' · ')}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <PartnerRegistry partners={partners} canManage={canManage} />
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-meta text-muted-foreground">{label}</p>
      {/* On the scale, like everything else. These were text-base and text-sm — the last
          two figures in the app sized off it. */}
      <p className={`tnum ${strong ? 'text-lead font-semibold' : 'text-body'}`}>{value}</p>
    </div>
  );
}
