import Link from 'next/link';
import { Share2, TriangleAlert } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BarChart } from '@/components/charts/BarChart';
import { hasDb } from '@/lib/prisma';
import { socialOverview } from '@/lib/social';
import { fmtCompact, fmtNumber, fmtPercent, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Social · Growth Center' };

/**
 * The title and subtitle are the prerendered shell: they are the same on every request,
 * so under cacheComponents they are served from the edge while the data behind them is
 * still being fetched. Everything that touches the database sits in the body below,
 * inside a Suspense boundary, which is what lets the shell go out first.
 */
export default function SocialPage() {
  return (
    <>
      <PageHeader
        title="Social"
        // The count is data, so it streams in behind the generic line rather than holding
        // the whole header back. socialOverview is cached, so asking for it here and in
        // the body below is one read, not two.
        subtitle={
          <Suspense fallback="Accounts, reach and engagement.">
            <SocialSubtitle />
          </Suspense>
        }
      />
      <Suspense fallback={<PageSkeleton headless />}>
        <SocialBody />
      </Suspense>
    </>
  );
}

async function SocialSubtitle() {
  if (!hasDb()) return 'Accounts, reach and engagement.';
  const { accounts, totals } = await socialOverview();
  if (accounts.length === 0) return 'Accounts, reach and engagement.';
  return `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} · ${fmtCompact(totals.followers)} followers`;
}

async function SocialBody() {
  if (!hasDb()) {
    return <Card><NoDatabaseState /></Card>;
  }

  const { accounts, reportedAccounts, recent, totals, seededNetworks } = await socialOverview();

  if (accounts.length === 0) {
    // Two different empty pages. An integration that is reporting accounts nobody can see
    // is a sync fault, and telling that reader to go and connect Facebook is both wrong and
    // a dead end — they already have.
    const reporting = reportedAccounts.length > 0;
    return (
      <>
        <Card>
          <EmptyState
            icon={reporting ? <TriangleAlert className="size-6" /> : <Share2 className="size-6" />}
            title={reporting ? 'Accounts are being reported but none are stored' : 'No social accounts'}
            hint={
              reporting
                ? `${reportedAccounts.length} account${reportedAccounts.length === 1 ? '' : 's'} — ${reportedAccounts
                    .map((a) => a.entityId)
                    .join(', ')} — last reported ${fmtRelative(
                    reportedAccounts.reduce<Date | null>(
                      (latest, a) => (a.lastSeen && (!latest || a.lastSeen > latest) ? a.lastSeen : latest),
                      null,
                    ),
                  )}. Run the sync again from the Integration Center; if this persists the connection is reporting accounts the app cannot key.`
                : 'Connect Facebook and Instagram on the Integrations page. LinkedIn needs their Marketing Developer Platform approval.'
            }
          />
        </Card>
      </>
    );
  }

  // Whether any post has been synced at all. Connecting an account brings its follower
  // count over immediately, but post-level insights arrive on the next sync — so a freshly
  // connected workspace has real followers and no posts, and every per-post figure on the
  // page is a zero that reads as "nobody saw it" rather than "not reported yet". The
  // tiles, the accounts columns and the reach chart all hang off this.
  const reported = totals.posts > 0;

  // Two accounts can sit on one network, and the network alone then labels both bars the
  // same. The handle is what distinguishes them.
  const networkCounts = new Map<string, number>();
  for (const a of accounts) networkCounts.set(a.network, (networkCounts.get(a.network) ?? 0) + 1);
  const barLabel = (a: (typeof accounts)[number]) =>
    (networkCounts.get(a.network) ?? 0) > 1 ? `@${a.handle}` : a.network;

  return (
    <>
      {seededNetworks.length > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs text-warning">
            {seededNetworks.length === accounts.length
              ? 'These figures are seeded — no social account is connected.'
              : `Some figures are seeded: ${seededNetworks.join(', ')}. The rest come from a live connection.`}{' '}
            <Link href="/integrations" className="underline">Integrations</Link>
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Followers" value={fmtCompact(totals.followers)} />
        {/* A dash, not a zero: with no posts synced there is nothing that could have
            reached anyone, and 0 claims the posts flopped. */}
        <Stat
          label="Reach"
          value={reported ? fmtCompact(totals.reach) : '—'}
          sub={reported ? `across ${fmtNumber(totals.posts)} posts` : 'no posts synced yet'}
        />
        <Stat
          label="Engagements"
          value={reported ? fmtCompact(totals.engagements) : '—'}
          sub={
            totals.engagementRate === null
              ? undefined
              : `${fmtPercent(totals.engagementRate, 2)} of reach`
          }
        />
        <Stat label="Link clicks" value={reported ? fmtCompact(totals.clicks) : '—'} />
      </div>

      <div className={`grid gap-4 pb-4 ${reported ? 'lg:grid-cols-2' : ''}`}>
        {/* The chart plots reach, so with no reach to plot it was one flat bar against an
            invented 0–4 axis. It returns on its own with the first synced post. */}
        {reported ? (
          <BarChart
            title="Reach by account"
            data={accounts.map((a) => ({ label: barLabel(a), value: a.reach }))}
          />
        ) : null}
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH className="text-right">Followers</TH>
                  {/* Same test as the tiles: three columns of zeros, and in a half-width
                      card they pushed Eng. rate off the edge of the table. */}
                  {reported ? (
                    <>
                      <TH className="text-right">Posts</TH>
                      <TH className="text-right">Reach</TH>
                      <TH className="text-right">Eng. rate</TH>
                    </>
                  ) : null}
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
                    {reported ? (
                      <>
                        <TD className="text-right tnum text-muted-foreground">{fmtNumber(a.posts)}</TD>
                        <TD className="text-right tnum">{fmtCompact(a.reach)}</TD>
                        <TD className="text-right tnum">{fmtPercent(a.engagementRate, 2)}</TD>
                      </>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent posts</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Reporting only — there is deliberately no publishing here, which would need a live
            publish API.
          </p>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState
            icon={<Share2 className="size-6" />}
            title="No posts synced yet"
            hint={
              seededNetworks.length === accounts.length
                ? 'Connect an account on the Integrations page to pull its posts and their reach.'
                : 'The connection brought the follower count over; post-level insights arrive on the next sync.'
            }
          />
        ) : (
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
                      {/* The permalink was already being fetched and then thrown away. */}
                      {p.permalink ? (
                        <Link
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block truncate text-sm hover:underline"
                        >
                          {p.caption ?? 'View post'}
                        </Link>
                      ) : (
                        <p className="truncate text-sm">{p.caption ?? '—'}</p>
                      )}
                    </TD>
                    <TD><Badge tone="neutral">{p.network}</Badge></TD>
                    <TD className="text-right tnum">{fmtCompact(p.reach)}</TD>
                    <TD className="text-right tnum">{fmtNumber(p.engagements)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtPercent(p.engagementRate, 2)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(p.clicks)}</TD>
                    <TD className="text-right text-muted-foreground">{fmtRelative(p.publishedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
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
