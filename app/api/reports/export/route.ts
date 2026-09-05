import { requirePermission } from '@/lib/auth';
import { fail } from '@/lib/api';
import { buildReport, isReportId } from '@/lib/reports';
import { hasDb } from '@/lib/prisma';
import { csvCell as cell, csvDocument } from '@/lib/csv';
import { reportPdf } from '@/lib/pdf';

// Returns a file rather than JSON, so it cannot use route() — that wraps every result in
// NextResponse.json. There was no export anywhere in the product; a report could be read
// on screen and nowhere else.
//
// Two formats, one report. §17 asks for PDF; CSV is what an analyst wants and what was
// here first. Both are rendered from the same `Report` object the screen is built from,
// so an export cannot disagree with the page it came from.
//
// Node runtime, declared: the PDF renderer uses Buffer and Node streams, which the edge
// runtime does not provide. Without this the route builds and fails at request time.


export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    await requirePermission('growth:read');
  } catch {
    return fail(401, 'Not signed in');
  }

  if (!hasDb()) return fail(503, 'No database configured');

  const url = new URL(req.url);
  const raw = url.searchParams.get('report') ?? 'executive';
  if (!isReportId(raw)) return fail(422, `Unknown report: ${raw}`);

  const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days') ?? 30) || 30));
  const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv';
  const report = await buildReport(raw, days);

  const stem = `${report.id}-${report.range.to.toISOString().slice(0, 10)}`;

  if (format === 'pdf') {
    const pdf = await reportPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${stem}.pdf"`,
        'content-length': String(pdf.byteLength),
        'cache-control': 'no-store',
      },
    });
  }

  const lines: string[] = [];
  lines.push([report.name].map(cell).join(','));
  lines.push(
    [`${report.range.from.toISOString().slice(0, 10)} to ${report.range.to.toISOString().slice(0, 10)}`]
      .map(cell)
      .join(','),
  );
  lines.push('');

  for (const section of report.sections) {
    lines.push([section.title].map(cell).join(','));

    if (section.kind === 'stats') {
      for (const row of section.rows) {
        lines.push([row.label, row.value, row.hint ?? ''].map(cell).join(','));
      }
    } else if (section.kind === 'table') {
      lines.push(section.columns.map(cell).join(','));
      for (const row of section.rows) lines.push(row.map(cell).join(','));
    } else {
      lines.push([section.body].map(cell).join(','));
    }

    lines.push('');
  }

  return new Response(
    csvDocument(lines),
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${stem}.csv"`,
        'cache-control': 'no-store',
      },
    },
  );
}
