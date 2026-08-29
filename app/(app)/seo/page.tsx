import { Search, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { StateBadge } from '@/components/patterns/integration-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { seoOverview } from '@/lib/seo';
import { cards } from '@/lib/integrations/service';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';

export const metadata = { title: 'SEO · Growth Center' };

export default async function SeoPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="SEO" subtitle="Keywords, rankings and the pages that earn them." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const [data, providers] = await Promise.all([seoOverview(), cards()]);
  const searchConsole = providers.find((p) => p.id === 'google_search_console');

  if (!data) {
    return (
      <>
        <PageHeader title="SEO" subtitle="Keywords, rankings and the pages that earn them." />
        <Card>
          <EmptyState
            icon={<Search className="size-6" />}
            title="No website configured"
            hint="Run npm run db:seed for demo data, or connect Google Search Console to pull real keyword data."
          />
        </Card>
      </>
    );
  }

  const { totals, keywords, pages, issues, website, liveness } = data;
  const movers = keywords.filter((k) => k.move !== null && k.move !== 0);
  const improved = [...movers].sort((a, b) => (b.move ?? 0) - (a.move ?? 0)).slice(0, 5);
  const declined = [...movers].sort((a, b) => (a.move ?? 0) - (b.move ?? 0)).slice(0, 5);

  return (
    <>
      <PageHeader
        title="SEO"
        subtitle={`${website.domain} — ${totals.keywords} tracked keywords`}
        actions={searchConsole ? <StateBadge state={searchConsole.state} /> : null}
      />

      {/* Keyed on whether these rows actually came from a provider, NOT on whether an SEO
          integration is merely connected — a connection that has never synced leaves
          every row on this page seeded. */}
      {!liveness.allLive ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs text-warning">
            {liveness.hasLive
              ? `${liveness.seeded} of ${liveness.seeded + liveness.live} keyword and page rows are still seeded; the rest come from Search Console.`
              : 'Rankings and page data are seeded, not crawled.'}{' '}
            {searchConsole?.state === 'connected' || searchConsole?.state === 'syncing'
              ? 'Run a Search Console sync to replace them with real ones.'
              : 'Connect Google Search Console to replace them with real ones.'}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Top 3" value={fmtNumber(totals.inTop3)} sub={`of ${totals.keywords} tracked`} />
        <Stat label="Top 10" value={fmtNumber(totals.inTop10)} />
        <Stat label="Clicks" value={fmtNumber(totals.clicks)} sub={`${fmtPercent(totals.ctr ?? 0, 2)} CTR`} />
        <Stat label="Impressions" value={fmtNumber(totals.impressions)} />
        <Stat
          label="Movement"
          value={`${totals.improved} up`}
          sub={`${totals.declined} down since last check`}
        />
      </div>

      <div className="grid gap-4 pb-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Biggest gains</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {improved.length === 0 ? (
              <p className="text-xs text-muted-foreground">No keyword improved since the last check.</p>
            ) : improved.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{k.keyword}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-success tnum">+{k.move}</span>
                  <Badge tone="neutral">#{k.position}</Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Biggest losses</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {declined.length === 0 ? (
              <p className="text-xs text-muted-foreground">No keyword declined since the last check.</p>
            ) : declined.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{k.keyword}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-destructive tnum">{k.move}</span>
                  <Badge tone="neutral">#{k.position}</Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader><CardTitle>Tracked keywords</CardTitle></CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Keyword</TH>
                <TH className="text-right">Position</TH>
                <TH className="text-right">Change</TH>
                <TH className="text-right">Volume</TH>
                <TH className="text-right">Difficulty</TH>
                <TH className="text-right">CPC</TH>
                <TH>Intent</TH>
                <TH className="text-right">Checked</TH>
              </TR>
            </THead>
            <TBody>
              {keywords.map((k) => (
                <TR key={k.id}>
                  <TD className="font-medium">{k.keyword}</TD>
                  <TD className="text-right tnum">{k.position === null ? '—' : `#${k.position}`}</TD>
                  <TD className="text-right tnum">
                    {k.move === null || k.move === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={k.move > 0 ? 'text-success' : 'text-destructive'}>
                        {k.move > 0 ? `+${k.move}` : k.move}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tnum text-muted-foreground">{fmtNumber(k.searchVolume)}</TD>
                  <TD className="text-right tnum text-muted-foreground">{k.difficulty ?? '—'}</TD>
                  <TD className="text-right tnum text-muted-foreground">{k.cpc === null ? '—' : fmtMoney(k.cpc, true)}</TD>
                  <TD className="text-muted-foreground">{k.intent ?? '—'}</TD>
                  <TD className="text-right text-muted-foreground">{fmtDate(k.lastChecked)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Pages</CardTitle></CardHeader>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>URL</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">Impr.</TH>
                  <TH className="text-right">CTR</TH>
                  <TH className="text-right">Avg pos.</TH>
                </TR>
              </THead>
              <TBody>
                {pages.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-mono text-xs">{p.url}</TD>
                    <TD className="text-right tnum">{fmtNumber(p.clicks)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtNumber(p.impressions)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{fmtPercent(p.ctr, 2)}</TD>
                    <TD className="text-right tnum text-muted-foreground">{p.avgPosition.toFixed(1)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader><CardTitle>Technical issues ({issues.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {issues.length === 0 ? (
              <p className="text-xs text-muted-foreground">No issues recorded.</p>
            ) : issues.map((i, idx) => (
              <div key={`${i.url}-${idx}`} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs">{i.url}</p>
                  <Badge tone={i.severity === 'high' ? 'danger' : i.severity === 'medium' ? 'warning' : 'neutral'}>
                    {i.severity}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs">{i.code.replaceAll('-', ' ')}</p>
                {i.message ? <p className="text-[11px] text-muted-foreground">{i.message}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
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
