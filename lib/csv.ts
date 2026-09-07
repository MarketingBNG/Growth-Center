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

/**
 * Reads a CSV back into rows of cells.
 *
 * The other half of this file. Everything above writes a CSV for a person to open; this
 * reads one a person has saved out of Excel or Sheets, which is the only shape a content
 * calendar ever arrives in.
 *
 * Written out rather than pulled from a library because the awkward parts are few and
 * all of them are in the format itself:
 *
 *   - A quoted field may contain commas, CRLFs and doubled quotes, so the line breaks
 *     cannot be found by splitting on newlines first. This walks the string once.
 *   - Excel writes CRLF, Sheets writes LF, and a file that has been through both has
 *     some of each. A bare CR is treated as a line break too, for the Mac-era exports
 *     that still turn up.
 *   - The byte-order mark that `csvDocument` writes — and that Excel writes — is not
 *     part of the first header.
 *   - `csvCell` prefixes a formula-looking value with an apostrophe on the way out. That
 *     apostrophe is left alone on the way in: stripping it would silently rewrite a
 *     legitimate value, and a title that begins with one is a title, not an attack.
 *
 * Ragged rows are returned as they are, short or long. Deciding what a missing cell means
 * belongs to whoever knows what the column was.
 */
export function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  // Set by the first cell of the first row, and only there: a BOM anywhere else is data.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch !== '"') {
        cell += ch;
        continue;
      }
      // A doubled quote is one literal quote; a single one closes the field.
      if (text[i + 1] === '"') {
        cell += '"';
        i++;
        continue;
      }
      quoted = false;
      continue;
    }

    if (ch === '"' && cell === '') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      endCell();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      // CRLF is one break, not two.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    cell += ch;
  }

  // A file that does not end in a newline still has a last row; one that does must not
  // gain an empty one.
  if (cell !== '' || row.length) endRow();

  return rows;
}
