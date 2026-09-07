import ExcelJS from 'exceljs';
import { EXPORT_HEADERS, calendarRowsForExport, monthLabel } from './content-calendar.ts';

// Excel, kept in its own module on purpose.
//
// exceljs is a large dependency that reads and writes a zip archive, and it is needed by
// two route handlers and nothing else. The content page imports `content-calendar.ts` to
// render the month; if the workbook code lived there, every render of that page would
// pull a spreadsheet library into the server bundle for no reason.
//
// Node runtime only. Both callers declare it.

/**
 * A worksheet as a plain grid, for `readSheet`.
 *
 * Cell values come back from exceljs as whatever the sheet holds — a string, a number, a
 * Date for a date-formatted cell, or an object for the three cases below. All of them
 * reduce to a string or a Date, which is what the reader in content-calendar.ts expects,
 * and the Date is preserved rather than stringified because a real date needs no parsing.
 *
 * `sheetRows` walks by index rather than with `eachRow`, because `eachRow` skips rows the
 * sheet considers empty and the reader needs a row's real number to say which row of the
 * file it refused.
 */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  // A hyperlinked cell: the text is what a person sees, the target is in `hyperlink`.
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  // Mixed formatting within one cell, as runs.
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((r) => r.text ?? '').join('');
  }
  // A formula's last computed value. `result` is what the sheet displays; the formula
  // itself is of no use here, and an error result reduces to nothing.
  if (typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return result;
    if (result === null || result === undefined || typeof result === 'object') return '';
    return result;
  }
  return '';
}

/** The first worksheet of a workbook, as rows of cells. */
export async function xlsxGrid(bytes: ArrayBuffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  // The first sheet, not a named one: a calendar exported from Sheets is one sheet, and a
  // workbook with several has the month's plan on the first of them. A file where it is
  // not first fails with "no header row found", which names the problem.
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const grid: unknown[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= Math.max(sheet.columnCount, row.cellCount); c++) {
      cells.push(cellValue(row.getCell(c).value));
    }
    grid.push(cells);
  }
  return grid;
}

/**
 * The month as a workbook.
 *
 * Same columns and same order as the CSV export, so the two are interchangeable and a
 * calendar can go out as either and come back as either. The header row is frozen and
 * bold, and the columns are given widths, because the point of choosing .xlsx over .csv
 * is that it opens ready to work in.
 */
export async function calendarXlsx(month: Date): Promise<Buffer> {
  const rows = await calendarRowsForExport(month);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Growth Center';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(monthLabel(month), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.addRow([...EXPORT_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);

  // Wide enough for the column's own name, and for a title or a brief without being
  // absurd about it. Measured from the content rather than fixed, so a month of short
  // titles does not open with a screen of empty space.
  EXPORT_HEADERS.forEach((header, i) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), header.length);
    sheet.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
