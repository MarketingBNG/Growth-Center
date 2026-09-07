import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import {
  csvGrid,
  importCalendar,
  monthKey,
  parseMonth,
  readSheet,
} from '@/lib/content-calendar';
import { xlsxGrid } from '@/lib/content-calendar-xlsx';

// Takes a content calendar as a file and turns it into pieces for one month.
//
// Node runtime, declared: reading an .xlsx is unzipping an archive, and exceljs uses
// Buffer and Node streams to do it. Without this the route builds and fails at request
// time — the same trap /api/reports/export documents for the PDF renderer.
export const runtime = 'nodejs';

/**
 * Enough for a year of calendars in one sheet and nothing like enough to be a way to
 * spend the function's memory. A month of content is tens of rows; a legitimate file is
 * measured in tens of kilobytes.
 */
const MAX_BYTES = 5 * 1024 * 1024;

export const POST = route('content:write', async (user, req) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Send the file as multipart form data.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file was uploaded.');
  if (file.size === 0) throw new HttpError(422, 'That file is empty.');
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `That file is ${(file.size / 1_048_576).toFixed(1)}MB. The limit is 5MB.`);
  }

  // The month is asked for rather than inferred from the rows, because it is the thing
  // being replaced. A file whose dates are all in October, uploaded as September, should
  // fail loudly with 30 out-of-month reasons — not quietly scatter a month of posts into
  // one nobody was looking at.
  const month = parseMonth(String(form.get('month') ?? ''));
  if (!month) throw new HttpError(422, 'Give the month as YYYY-MM, e.g. 2026-09.');

  const replace = String(form.get('replace') ?? '') === 'true';

  const name = file.name || 'calendar';
  const extension = name.toLowerCase().split('.').pop() ?? '';

  let grid: readonly (readonly unknown[])[];
  let fileFormat: 'csv' | 'xlsx';

  if (extension === 'csv' || extension === 'txt') {
    fileFormat = 'csv';
    grid = csvGrid(await file.text());
  } else if (extension === 'xlsx' || extension === 'xlsm') {
    fileFormat = 'xlsx';
    grid = await xlsxGrid(await file.arrayBuffer());
  } else if (extension === 'xls') {
    // The pre-2007 binary format, which is a different file type wearing a similar name.
    // Saying so is more use than "unsupported": the fix is one menu item away.
    throw new HttpError(
      422,
      'That is the old .xls format, which cannot be read here. Open it and use Save As to make it .xlsx or .csv.',
    );
  } else {
    throw new HttpError(422, `Cannot read a .${extension || 'file'}. Upload a .csv or an .xlsx.`);
  }

  const sheet = readSheet(grid, month);

  // Nothing readable at all is a failure, not an import of zero. An import row saying
  // "0 pieces" would sit above the calendar claiming a calendar had arrived.
  if (!sheet.rows.length) {
    throw new HttpError(
      422,
      sheet.skippedReasons[0] ??
        `No rows in that file could be read as content for ${monthKey(month)}.`,
      );
  }

  return importCalendar({
    month,
    sheet,
    fileName: name,
    fileFormat,
    actorEmail: user.email,
    replace,
  });
});
