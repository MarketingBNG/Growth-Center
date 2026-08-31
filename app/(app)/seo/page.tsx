import { Search, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { StateBadge } from '@/components/patterns/integration-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { searchTrend, seoOverview } from '@/lib/seo';
import { currencySettings } from '@/lib/settings';
import { cards } from '@/lib/integrations/service';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';
import { TrendChart } from '@/components/charts/TrendChart';
import { Sparkline } from '@/components/charts/Sparkline';

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

  const [data, providers, search, fx] = await Promise.all([
    seoOverview(),
    cards(),
    searchTrend(),
    currencySettings(),
  ]);
  const searchConsole = providers.find((p) => p.id === 'google_search_console');

  if (!data) {
    return (
      <>
        <PageHeader title="SEO" subtitle="Keywords, rankings and the pages that earn them." />
        <Card>
          <EmptyState
            icon={<Search className="size-6" />}
            title="No website configured"
            hint="Connect Google Search Console on the Integrations page to pull real keyword data."
          />
        </Card>
      </>
    );
  }

  const { totals, keywords, pages, issues, website, liveness } = data;

  // Capped: 1,760 rows in one table is a page nobody scrolls and a DOM nobody needs.
  // Ordered by impressions upstream, so the cap keeps the keywords that matter.
  const KEYWORD_ROWS = 100;
  const shown = keywords.slice(0, KEYWORD_ROWS);

  // Same reason as the keyword cap: 243 URLs in a half-width card is a scroll nobody
  // finishes. Ordered by clicks upstream, so the cap keeps the pages that earn.
  const PAGE_ROWS = 25;
  const shownPages = pages.slice(0, PAGE_ROWS);

  // Clicks and impressions come from two places that cover two different windows: the
  // page table holds whatever the last sync pulled, the daily series holds the last N
  // days. Printing one in a tile and the other in a chart headline put two different
  // click counts on the same screen under the same word. The tiles follow the series
  // whenever there is one, and say which window they mean either way.
  const period = search
    ? { clicks: search.clicks, impressions: search.impressions, ctr: search.ctr, note: `last ${search.days} days` }
    : { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.ctr, note: 'last sync window' };

  // Search Console reports no volume, difficulty, CPC or intent. The columns stay in the
  // markup for whenever something that does report them is connected.
  const hasKeywordTool = keywords.some((k) => k.searchVolume !== null || k.difficulty !== null);
  const movers = keywords.filter((k) => k.move !== null && k.move !== 0);
  const improved = [...movers].sort((a, b) => (b.move ?? 0) - (a.move ?? 0)).slice(0, 5);
  const declined = [...movers].sort((a, b) => (a.move ?? 0) - (b.move ?? 0)).slice(0, 5);

  return (
    <>
      <PageHeader
        title="SEO"
        subtitle={`${website.domain} — ${fmtNumber(totals.keywords)} tracked keywords`}
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
        <Stat label="Top 3" value={fmtNumber(totals.inTop3)} sub={`of ${fmtNumber(totals.keywords)} tracked`} />
        <Stat label="Top 10" value={fmtNumber(totals.inTop10)} />
        <Stat label="Clicks" value={fmtNumber(period.clicks)} sub={`${fmtPercent(period.ctr, 2)} CTR · ${period.note}`} />
        <Stat label="Impressions" value={fmtNumber(period.impressions)} sub={period.note} />
        <Stat
          label="Movement"
          value={`${totals.improved} up`}
          sub={`${totals.declined} down of ${fmtNumber(totals.compared)} with a prior reading`}
        />
      </div>

      {/* Search Console reports these daily and nothing plotted them, so the page could
          only ever show one all-time total and no movement at all. */}
      {/* Two charts, not two series on one: impressions run two orders of magnitude above
          clicks, so sharing an axis would flatten the clicks line onto zero. */}
      {search ? (
        <div className="grid gap-4 pb-4 lg:grid-cols-2">
          <TrendChart
            title="Search clicks"
            subtitle={`Last ${search.days} days · Google Search Console`}
            headline={fmtNumber(search.clicks)}
            headlineNote={`${search.ctr === null ? '—' : fmtPercent(search.ctr, 2)} CTR`}
            data={search.data}
            series={[{ key: 'clicks', label: 'Clicks', kind: 'number' }]}
          />
          <TrendChart
            title="Search impressions"
            subtitle={`Last ${search.days} days · average position ${
              search.position === null ? '—' : search.position.toFixed(1)
            }`}
            headline={fmtNumber(search.impressions)}
            data={search.data}
            series={[{ key: 'impressions', label: 'Impressions', kind: 'number' }]}
          />
        </div>
      ) : null}

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
        <CardHeader>
          <CardTitle>Tracked keywords</CardTitle>
          <p className="text-xs text-muted-foreground">
            {shown.length === keywords.length
              ? `${fmtNumber(keywords.length)} keywords, most impressions first`
              : `Top ${fmtNumber(shown.length)} of ${fmtNumber(keywords.length)} by impressions`}
          </p>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Keyword</TH>
                <TH className="text-right">Position</TH>
                <TH className="text-right">Change</TH>
                <TH>Trend</TH>
                <TH className="text-right">Clicks</TH>
                <TH className="text-right">Impressions</TH>
                {/* Only when something can fill them. Search Console reports none of
                    these, and four columns of em dashes took half the table. */}
                {hasKeywordTool ? (
                  <>
                    <TH className="text-right">Volume</TH>
                    <TH className="text-right">Difficulty</TH>
                    <TH className="text-right">CPC</TH>
                    <TH>Intent</TH>
                  </>
                ) : null}
                <TH className="text-right">Checked</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((k) => (
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
                  <TD>
                    <Sparkline values={k.history} lowerIsBetter />
                  </TD>
                  <TD className="text-right tnum">{fmtNumber(k.clicks)}</TD>
                  <TD className="text-right tnum text-muted-foreground">{fmtNumber(k.impressions)}</TD>
                  {hasKeywordTool ? (
                    <>
                      <TD className="text-right tnum text-muted-foreground">{fmtNumber(k.searchVolume)}</TD>
                      <TD className="text-right tnum text-muted-foreground">{k.difficulty ?? '—'}</TD>
                      <TD className="text-right tnum text-muted-foreground">{k.cpc === null ? '—' : fmtMoney(k.cpc, true, fx.reporting)}</TD>
                      <TD className="text-muted-foreground">{k.intent ?? '—'}</TD>
                    </>
                  ) : null}
                  <TD className="text-right text-muted-foreground">{fmtDate(k.lastChecked)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Pages</CardTitle>
            <p className="text-xs text-muted-foreground">
              {shownPages.length === pages.length
                ? `${fmtNumber(pages.length)} pages, most clicks first`
                : `Top ${fmtNumber(shownPages.length)} of ${fmtNumber(pages.length)} by clicks`}
            </p>
          </CardHeader>
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
                {shownPages.map((p) => (
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
