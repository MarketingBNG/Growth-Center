import { requirePermission } from '@/lib/auth';
import { fail } from '@/lib/api';
import { buildReport, isReportId } from '@/lib/reports';
import { hasDb } from '@/lib/prisma';

// Returns CSV rather than JSON, so it cannot use route() — that wraps every result in
// NextResponse.json. There was no export anywhere in the product; a report could be read
// on screen and nowhere else.

/** RFC 4180: quote anything containing a comma, quote or newline, and double the quotes. */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

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
  const report = await buildReport(raw, days);

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

  const filename = `${report.id}-${report.range.to.toISOString().slice(0, 10)}.csv`;

  return new Response(
    // Excel reads a UTF-8 CSV as Latin-1 without a BOM, which mangles the currency
    // symbols and em dashes these reports are full of.
    `\uFEFF${lines.join('\r\n')}`,
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    },
  );
}
