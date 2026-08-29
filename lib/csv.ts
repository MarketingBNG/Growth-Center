// CSV writing. Pure and import-free so tools/csv.test.ts can exercise it, and because
// the escaping is the only part worth getting exactly right.

/**
 * One cell, escaped for RFC 4180 and for the spreadsheet that will open it.
 *
 * Two separate problems, and the second is the dangerous one.
 *
 * Quoting handles commas, quotes and newlines, so a company called "Smith, Jones & Co"
 * stays one field.
 *
 * The prefix handles formula injection. Excel, Sheets and LibreOffice all evaluate a cell
 * beginning with `=`, `+`, `-`, `@`, tab or carriage return, so a company name of
 * `=cmd|'/c calc'!A1` — a name that arrives from whatever the CRM contains and that no
 * one here chose — becomes a command on the reader's machine when they open the export.
 * These reports go to a finance team, which is exactly who opens a CSV in Excel.
 *
 * A leading apostrophe is the standard defence: spreadsheets read the rest as text and
 * hide the apostrophe, so the cell still displays the value it was given.
 */
export function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const escaped = risky ? `'${value}` : value;
  return /[",\r\n]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

/** A row, already escaped. */
export const csvRow = (cells: (string | null | undefined)[]): string =>
  cells.map((c) => csvCell(c ?? '')).join(',');

/**
 * The finished document.
 *
 * CRLF because RFC 4180 says so, and a byte-order mark because Excel reads a UTF-8 CSV
 * as Latin-1 without one — which mangles every currency symbol and em dash in a report
 * that is mostly currency symbols and em dashes.
 */
export const csvDocument = (lines: string[]): string => `\uFEFF${lines.join('\r\n')}`;
