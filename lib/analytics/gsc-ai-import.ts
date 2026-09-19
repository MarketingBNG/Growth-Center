/**
 * Reading Search Console's AI performance export.
 *
 * Google reports impressions in AI Overviews and AI Mode inside the Search Console
 * interface and offers no API for it — there is no endpoint to sync, so the only way these
 * numbers reach this application is somebody exporting the report and uploading the file.
 * That is a worse mechanism than a sync and it is the only one available; what can be done
 * is to make the failure modes loud.
 *
 * Pure, and touches no database, so it can be exercised on fixtures by bare node. The
 * storing half is the route that calls it.
 *
 * ## Why the column matching is generous and the rejection is strict
 *
 * The file is whatever Google's export produced on the day, in whatever language and
 * locale the person's account uses, from a report whose name has already changed once.
 * Pinning it to exact headers would break the import the first time Google renamed a
 * column, and the person uploading cannot fix that. So headers are matched loosely.
 *
 * But a file that does not have the two columns this needs is rejected outright rather
 * than imported as far as it goes. The failure this guards against is the wrong export —
 * the Queries tab instead of the Pages tab, which parses perfectly and would silently
 * file a list of search terms as a list of URLs.
 */
import { csvParse } from '../shared/csv.ts';

/** Written on every row this import stores, so it is separable from synced data. */
export const AI_IMPORT_SOURCE = 'gsc_ai_export';

/** The metric the impressions land in. */
export const AI_IMPRESSIONS_KEY = 'ai_impressions';

export class AiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiImportError';
  }
}

export type AiImportRow = {
  url: string;
  impressions: number;
  clicks: number | null;
  position: number | null;
};

export type AiImportResult = {
  rows: AiImportRow[];
  /** Lines that could not be read, with the reason, so the person can fix the file. */
  skipped: { line: number; reason: string }[];
  /** Which header each column was matched from, for the confirmation message. */
  matched: { url: string; impressions: string };
};

/** Header spellings seen across Google's exports and locales, lower-cased. */
const URL_HEADERS = ['page', 'top pages', 'url', 'urls', 'landing page', 'address', 'seite', 'página'];
const IMPRESSION_HEADERS = [
  'ai impressions',
  'impressions',
  'ai overview impressions',
  'impressionen',
  'impresiones',
];
const CLICK_HEADERS = ['ai clicks', 'clicks', 'klicks', 'clics'];
const POSITION_HEADERS = ['position', 'average position', 'avg position', 'avg. position'];

const normalise = (header: string) =>
  header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    // Google writes "Impressions*" with a footnote marker in some exports.
    .replace(/[*†]+$/, '')
    .replace(/\s+/g, ' ');

/**
 * Finds a column by header.
 *
 * Exact match first, then "starts with". Order matters: `Impressions` must not be matched
 * by a `starts with` pass before `AI impressions` has had its exact chance, or a file
 * carrying both columns would file ordinary search impressions as AI ones.
 */
function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const exact = headers.indexOf(candidate);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const partial = headers.findIndex((h) => h.startsWith(candidate));
    if (partial !== -1) return partial;
  }
  return -1;
}

/**
 * A number as a spreadsheet wrote it.
 *
 * Thousands separators, a trailing percent sign, and the European convention of a comma
 * for the decimal point — all of which arrive from a locale nobody chose deliberately.
 * Returns null rather than NaN so a bad cell is a skipped row with a reason.
 */
export function parseNumber(raw: string): number | null {
  let text = raw.trim().replace(/%$/, '').replace(/\s/g, '');
  if (!text) return null;
  // "1.234,56" is European; "1,234.56" is not. Told apart by which separator comes last.
  //
  // With only a comma it is genuinely ambiguous: "1,234" is 1234 to an American and 1.234
  // to a German, and nothing in the cell says which. Resolved on the digit count, the
  // usual convention — exactly three digits after the comma and no dot anywhere is a
  // thousands separator, anything else is a decimal point. So "1,234" is 1234 and "4,2" is
  // 4.2. It can still be wrong, for a German file whose value really is 1.234 impressions,
  // which is not a number of impressions anybody has.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastComma > lastDot) {
    const afterComma = text.length - lastComma - 1;
    if (afterComma === 3 && lastDot === -1) {
      text = text.replace(/,/g, '');
    } else {
      text = text.replace(/\./g, '').replace(',', '.');
    }
  } else {
    text = text.replace(/,/g, '');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** True for something that could be a page. Rejects the Queries export. */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

/**
 * Parses the export. Throws AiImportError with a sentence the uploader can act on.
 */
export function parseAiExport(text: string): AiImportResult {
  const grid = csvParse(text).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (!grid.length) throw new AiImportError('That file is empty.');

  const headers = grid[0].map(normalise);
  const urlAt = findColumn(headers, URL_HEADERS);
  const impressionsAt = findColumn(headers, IMPRESSION_HEADERS);

  // Named in the error, because "unrecognised format" sends somebody back to a file they
  // cannot see anything wrong with.
  const shown = grid[0].map((h) => h.trim()).filter(Boolean).join(', ') || '(no headers)';
  if (urlAt === -1) {
    throw new AiImportError(
      `That file has no page column. Export the Pages tab of the AI performance report. Columns found: ${shown}.`,
    );
  }
  if (impressionsAt === -1) {
    throw new AiImportError(
      `That file has no impressions column. Columns found: ${shown}.`,
    );
  }

  const clicksAt = findColumn(headers, CLICK_HEADERS);
  const positionAt = findColumn(headers, POSITION_HEADERS);

  const rows: AiImportRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < grid.length; i++) {
    // The line number a spreadsheet would show, so a reason can be acted on.
    const line = i + 1;
    const cells = grid[i];
    const url = (cells[urlAt] ?? '').trim();
    if (!url) {
      skipped.push({ line, reason: 'No page URL.' });
      continue;
    }
    if (!looksLikeUrl(url)) {
      skipped.push({
        line,
        reason: `"${url}" is not a URL. This looks like the Queries export rather than Pages.`,
      });
      continue;
    }
    // Google's export carries a totals row on some reports. Summed into the page table it
    // would be a phantom page with the traffic of the whole site.
    if (seen.has(url)) {
      skipped.push({ line, reason: `${url} appears more than once.` });
      continue;
    }

    const impressions = parseNumber(cells[impressionsAt] ?? '');
    if (impressions === null) {
      skipped.push({ line, reason: `Impressions for ${url} are not a number.` });
      continue;
    }
    if (impressions < 0) {
      skipped.push({ line, reason: `Impressions for ${url} are negative.` });
      continue;
    }

    seen.add(url);
    rows.push({
      url,
      impressions,
      clicks: clicksAt === -1 ? null : parseNumber(cells[clicksAt] ?? ''),
      position: positionAt === -1 ? null : parseNumber(cells[positionAt] ?? ''),
    });
  }

  // A file whose every row failed is a wrong file, not an import of nothing. The first
  // reason is the useful part of the message: they are nearly always all the same fault.
  if (!rows.length) {
    throw new AiImportError(
      skipped[0]
        ? `No rows could be read. First problem, line ${skipped[0].line}: ${skipped[0].reason}`
        : 'That file has headers but no rows.',
    );
  }

  return {
    rows,
    skipped,
    matched: { url: grid[0][urlAt]?.trim() ?? '', impressions: grid[0][impressionsAt]?.trim() ?? '' },
  };
}
