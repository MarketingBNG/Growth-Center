import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { RangePicker } from '@/components/patterns/range-picker';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasDb } from '@/lib/prisma';
import { buildReport, isReportId, REPORTS } from '@/lib/reports';
import { rangeParam } from '@/lib/range';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Reports · Growth Center' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Built from the same numbers as the dashboard." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const params = await searchParams;
  const { value, days } = rangeParam(params);
  const raw = typeof params.report === 'string' ? params.report : 'executive';
  const id = isReportId(raw) ? raw : 'executive';
  const report = await buildReport(id, days);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Composed from the same functions the pages use, so a report cannot disagree with the dashboard it came from."
        actions={<RangePicker current={value} />}
      />

      <div className="flex flex-wrap gap-1.5 pb-4">
        {REPORTS.map((r) => (
          <Link
            key={r.id}
            href={`/reports?report=${r.id}&range=${value}`}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              r.id === id
                ? 'border-primary/40 bg-primary/12 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {r.name}
          </Link>
        ))}
      </div>

      <div className="pb-4">
        <h2 className="text-lg font-semibold tracking-tight">{report.name}</h2>
        <p className="text-xs text-muted-foreground">
          {fmtDate(report.range.from)} — {fmtDate(report.range.to)} ·{' '}
          {REPORTS.find((r) => r.id === id)?.description}
        </p>
      </div>

      <div className="space-y-4">
        {report.sections.map((section, i) => {
          if (section.kind === 'note') {
            return (
              <Card key={i}>
                <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-xs leading-relaxed text-muted-foreground">{section.body}</p>
                </CardContent>
              </Card>
            );
          }

          if (section.kind === 'stats') {
            return (
              <Card key={i}>
                <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {section.rows.map((r) => (
                    <div key={r.label}>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                      <p className="pt-0.5 text-xl font-semibold tnum">{r.value}</p>
                      {r.hint ? <p className="text-[11px] text-muted-foreground">{r.hint}</p> : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={i} className="overflow-hidden">
              <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
              {section.rows.length === 0 ? (
                <p className="px-5 pb-5 text-xs text-muted-foreground">Nothing in this period.</p>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        {section.columns.map((c, ci) => (
                          <TH key={c} className={section.align?.[ci] === 'right' ? 'text-right' : undefined}>
                            {c}
                          </TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {section.rows.map((row, ri) => (
                        <TR key={ri}>
                          {row.map((cell, ci) => (
                            <TD
                              key={ci}
                              className={cn(
                                section.align?.[ci] === 'right' && 'text-right tnum',
                                ci === 0 && 'font-medium',
                              )}
                            >
                              {cell}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 pt-4 text-[11px] text-muted-foreground">
        <ClipboardList className="size-3" />
        Export is not built yet. Until it is, this renders in the browser only.
      </p>
    </>
  );
}
