import { requirePermission } from '@/lib/auth';
import { fail } from '@/lib/api';
import { hasDb } from '@/lib/prisma';
import { calendarCsv, currentMonth, parseMonth } from '@/lib/content-calendar';
import { calendarXlsx } from '@/lib/content-calendar-xlsx';

// The month as a file. Returns a download rather than JSON, so it cannot use route() —
// that wraps every result in NextResponse.json. Same shape as /api/reports/export, which
// is the only other route here that hands back a file.
//
// Node runtime, declared: writing an .xlsx is writing a zip archive, and exceljs uses
// Buffer to do it.
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    // Read, not write: exporting a calendar is looking at it. `content:write` would stop
    // a partner downloading the month they are being asked to approve.
    await requirePermission('growth:read');
  } catch {
    return fail(401, 'Not signed in');
  }

  if (!hasDb()) return fail(503, 'No database configured');

  const url = new URL(req.url);
  const requested = url.searchParams.get('month');
  const month = parseMonth(requested) ?? (requested ? null : currentMonth());
  if (!month) return fail(422, `Not a month: ${requested}. Use YYYY-MM, e.g. 2026-09.`);

  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const stem = `content-calendar-${month.toISOString().slice(0, 7)}`;

  if (format === 'xlsx') {
    const book = await calendarXlsx(month);
    return new Response(new Uint8Array(book), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${stem}.xlsx"`,
        'content-length': String(book.byteLength),
        'cache-control': 'no-store',
      },
    });
  }

  const csv = await calendarCsv(month);
  return new Response(csv, {
    headers: {
      // charset spelled out because the document opens with a byte-order mark and Excel
      // still guesses Latin-1 from a bare text/csv.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${stem}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
