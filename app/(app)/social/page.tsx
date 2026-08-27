import Link from 'next/link';
import { Share2, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BarChart } from '@/components/charts/BarChart';
import { hasDb } from '@/lib/prisma';
import { socialOverview } from '@/lib/social';
import { fmtCompact, fmtNumber, fmtPercent, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Social · Growth Center' };

export default async function SocialPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Social" subtitle="Accounts, reach and engagement." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const { accounts, recent, totals, seededNetworks } = await socialOverview();

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Social" subtitle="Accounts, reach and engagement." />
        <Card>
          <EmptyState
            icon={<Share2 className="size-6" />}
            title="No social accounts"
            hint="Run npm run db:seed for demo data. Connecting a live account needs a Meta or LinkedIn app."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Social" subtitle={`${accounts.length} accounts · ${fmtCompact(totals.followers)} followers`} />

      {seededNetworks.length > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs text-warning">
            {seededNetworks.length === accounts.length
              ? 'These figures are seeded — no social account is connected.'
              : `Some figures are seeded: ${seededNetworks.join(', ')}. The rest come from a live connection.`}{' '}
            There is deliberately no publishing here — that would need a live publish API.{' '}
            <Link href="/integrations" className="underline">Integrations</Link>
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Followers" value={fmtCompact(totals.followers)} />
        <Stat label="Reach" value={fmtCompact(totals.reach)} sub={`across ${totals.posts} posts`} />
        <Stat label="Engagements" value={fmtCompact(totals.engagements)} sub={`${fmtPercent(totals.engagementRate ?? 0, 2)} of reach`} />
        <Stat label="Link clicks" value={fmtCompact(totals.clicks)} />
      </div>

      <div className="grid gap-4 pb-4 lg:grid-cols-2">
        <BarChart
          title="Reach by account"
          data={accounts.map((a) => ({ label: a.network, value: a.reach }))}
        />
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH className="text-right">Followers</TH>
                  <TH className="text-right">Posts</TH>
                  <TH className="text-right">Reach</TH>
                  <TH className="text-right">Eng. rate</TH>
                </TR>
              </THead>
              <TBody>
                {accounts.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium capitalize">{a.network}</span>
                        {a.live ? null : <Badge tone="warning">seeded</Badge>}
                      </span>
                      <p className="text-[11px] text-muted-foreground">@{a.handle}</p>
                    </TD>
                    <TD className="text-right tnum">{fmtNumber(a.followers)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{a.posts}</TD>
                    <TD className="text-right tnum">{fmtCompact(a.reach)}</TD>
                    <TD className="text-right tnum">{fmtPercent(a.engagementRate ?? 0, 2)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Recent posts</CardTitle></CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Post</TH>
                <TH>Network</TH>
                <TH className="text-right">Reach</TH>
                <TH className="text-right">Engagements</TH>
                <TH className="text-right">Eng. rate</TH>
                <TH className="text-right">Clicks</TH>
                <TH className="text-right">Published</TH>
              </TR>
            </THead>
            <TBody>
              {recent.map((p) => (
                <TR key={p.id}>
                  <TD className="max-w-sm">
                    <p className="truncate text-sm">{p.caption ?? '—'}</p>
                  </TD>
                  <TD><Badge tone="neutral">{p.network}</Badge></TD>
                  <TD className="text-right tnum">{fmtCompact(p.reach)}</TD>
                  <TD className="text-right tnum">{fmtNumber(p.engagements)}</TD>
                  <TD className="text-right tnum text-muted-foreground">{fmtPercent(p.engagementRate ?? 0, 2)}</TD>
                  <TD className="text-right tnum text-muted-foreground">{fmtNumber(p.clicks)}</TD>
                  <TD className="text-right text-muted-foreground">{fmtRelative(p.publishedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="pt-1 text-2xl font-semibold tracking-tight tnum">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
