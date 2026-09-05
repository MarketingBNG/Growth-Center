import PDFDocument from 'pdfkit';
import type { Report } from './reports.ts';

// §17 asks for PDF and the exports were CSV. A CSV is the right thing to hand an analyst
// and the wrong thing to hand a board: it has no headings, no ordering that survives
// opening it, and it renders differently in every spreadsheet it touches.
//
// The same `Report` object the screen and the CSV are built from is rendered here, so an
// exported PDF cannot disagree with the page it came from — §4's reconciliation property,
// which this codebase already holds and which a second data path would break.

/**
 * Standard-14 Helvetica, so no font file ships with the application.
 *
 * That decision has one consequence worth naming, because it silently corrupts money.
 * The standard fonts encode as WinAnsi, which has no ₹ (U+20B9) — and pdfkit does not
 * fail on a character it cannot encode. It emits byte 0xB9, which in WinAnsi is ¹. So
 * ₹138,445,497 would have printed as ¹138,445,497, reading as a footnote marker against a
 * number, in the export most likely to be sent outside the firm.
 *
 * Verified by reading the emitted content stream, not assumed.
 *
 * Every other non-ASCII character these reports contain — — – × § — is in WinAnsi and
 * passes through correctly, so this is the only substitution needed.
 */
const RUPEE = '₹';

/**
 * Money for a document that may be printed, emailed or filed.
 *
 * "INR 138,445,497" rather than a symbol nobody can be sure rendered. Losing the glyph is
 * the point: an ISO code cannot be mistaken for anything else, and this report crosses
 * currencies — the workspace holds both INR and USD figures.
 */
export function pdfSafe(text: string): string {
  return text.replaceAll(RUPEE, 'INR ');
}

const PAGE = { size: 'A4' as const, margin: 48 };
const INK = '#1B1F24';
const MUTED = '#6A7280';
const RULE = '#D8DCE2';

/** Where the text column ends. Computed once so a table and a paragraph agree on it. */
const CONTENT_WIDTH = 595.28 - PAGE.margin * 2;

/**
 * Renders a report to PDF bytes.
 *
 * Returns a Buffer rather than a stream: the route needs a complete body to set
 * content-length, the largest of these reports is a few pages, and a stream that fails
 * halfway through a serverless response produces a truncated file that still downloads.
 */
export async function reportPdf(report: Report): Promise<Buffer> {
  const doc = new PDFDocument({ ...PAGE, info: { Title: report.name } });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(pdfSafe(report.name));
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`${from} to ${to}`);
  doc
    .fontSize(8)
    .text(
      `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Growth Center`,
    );
  doc.moveDown(1);

  for (const section of report.sections) {
    // A heading alone at the foot of a page is the commonest ugliness in a generated
    // document. Kept with at least a few lines of what it introduces.
    keepTogether(doc, 90);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(pdfSafe(section.title));
    doc.moveDown(0.4);

    if (section.kind === 'stats') {
      for (const row of section.rows) {
        keepTogether(doc, 40);
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(pdfSafe(row.label), PAGE.margin, y, {
          width: CONTENT_WIDTH * 0.55,
        });
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(INK)
          .text(pdfSafe(row.value), PAGE.margin + CONTENT_WIDTH * 0.55, y, {
            width: CONTENT_WIDTH * 0.45,
            align: 'right',
          });
        if (row.hint) {
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(pdfSafe(row.hint), PAGE.margin, doc.y, {
            width: CONTENT_WIDTH,
          });
        }
        doc.moveDown(0.35);
      }
    } else if (section.kind === 'table') {
      const columns = section.columns;
      const width = CONTENT_WIDTH / Math.max(1, columns.length);

      const header = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      columns.forEach((c, i) => {
        doc.text(pdfSafe(c).toUpperCase(), PAGE.margin + i * width, header, {
          width: width - 6,
          // Every column after the first is a figure in these reports, and a figure reads
          // right-aligned or it does not read at all.
          align: i === 0 ? 'left' : 'right',
        });
      });
      doc.moveDown(0.3);
      rule(doc);

      for (const row of section.rows) {
        keepTogether(doc, 30);
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(INK);
        row.forEach((cell, i) => {
          doc.text(pdfSafe(String(cell ?? '')), PAGE.margin + i * width, y, {
            width: width - 6,
            align: i === 0 ? 'left' : 'right',
            // One line per cell. A long channel name wrapping would push the row's own
            // figures out of alignment with every other row.
            lineBreak: false,
            ellipsis: true,
          });
        });
        doc.moveDown(0.45);
      }
      // A table that ended mid-page needs the cursor back under its last row, not beside it.
      doc.x = PAGE.margin;
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(pdfSafe(section.body), {
        width: CONTENT_WIDTH,
        align: 'left',
      });
    }

    doc.moveDown(1);
    doc.x = PAGE.margin;
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

/** A horizontal rule under a table header. */
function rule(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  doc.strokeColor(RULE).lineWidth(0.5).moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).stroke();
  doc.moveDown(0.3);
}

/**
 * Starts a new page when less than `needed` points remain.
 *
 * pdfkit paginates on its own when text overflows, but it does that *after* placing the
 * first line — which is what leaves a heading stranded alone at the bottom of a page with
 * its table on the next one.
 */
function keepTogether(doc: PDFKit.PDFDocument, needed: number) {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < needed) doc.addPage();
}
