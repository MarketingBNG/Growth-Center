/**
 * Reading and writing the content calendar.
 *
 * The database half: the month view, the import transaction, and the CSV export. The
 * parsing it stands on is next door in parse.ts and is deliberately free of Prisma.
 *
 * lib/content-calendar.ts re-exports both halves, so nothing that imports it changes.
 */
import { db } from '../platform/prisma.ts';
import { recordAudit } from '../platform/audit.ts';
import { csvDocument, csvRow } from '../shared/csv.ts';
import { CONTENT_STATUSES } from '../shared/enums.ts';
import {
  formatSlot,
} from '../content/content-fields.ts';
import { daysInMonth, monthKey, monthLabel, monthRange, type MonthKey, type SheetRead } from './parse.ts';

/**
 * A piece as the calendar shows it — and as its editor writes it back.
 *
 * Every field the edit form can change is here, including the ones the grid tile never
 * displays. That is not padding: the form sends the whole record on save, so a field the
 * page did not load would arrive back as empty and clear a target keyword or a topic
 * cluster that nobody touched. A month is tens of rows, so the columns are free; a
 * request per tile to fill in a form that may never open would not be.
 */
export type CalendarPiece = {
  id: string;
  title: string;
  format: string;
  assetShape: string | null;
  /** Minutes from midnight, wall-clock, or null where the piece has no slot. */
  publishMinute: number | null;
  status: (typeof CONTENT_STATUSES)[number];
  publishDate: Date;
  authorEmail: string | null;
  designerEmail: string | null;
  partnerVoice: string | null;
  channelSlug: string | null;
  brief: string | null;
  url: string | null;
  assetUrl: string | null;
  targetKeyword: string | null;
  topicCluster: string | null;
  segment: string | null;
  serviceLine: string | null;
  tags: string[];
  imported: boolean;
  approved: boolean;
};

export type CalendarDay = {
  /** Null for the leading and trailing blanks that pad the grid to whole weeks. */
  date: Date | null;
  pieces: CalendarPiece[];
};

export type CalendarImport = {
  id: string;
  importedByEmail: string;
  fileName: string;
  fileFormat: string;
  rowsRead: number;
  created: number;
  skipped: number;
  skippedReasons: string[];
  createdAt: Date;
  /** Pieces from this import still present. A replaced calendar keeps published work. */
  remaining: number;
};

/**
 * One month, as weeks of days.
 *
 * Weeks start on Monday. The working week here runs Monday to Saturday and a grid that
 * starts on Sunday puts the first working day of the week in the middle of a row.
 *
 * Padding days carry a null date rather than being omitted, so the grid is always whole
 * weeks and the template does not have to compute an offset.
 */
export async function contentCalendar(month: Date) {
  const { from, to } = monthRange(month);

  const [pieces, imports] = await Promise.all([
    db().contentPiece.findMany({
      where: { publishDate: { gte: from, lt: to } },
      // Within a day, by slot: three posts on the 7th are a running order, not a set.
      // Nulls last, because a piece with no time is not scheduled before one with 9:30.
      orderBy: [
        { publishDate: 'asc' },
        { publishMinute: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
      select: {
        id: true, title: true, format: true, status: true, publishDate: true,
        publishMinute: true, assetShape: true,
        authorEmail: true, designerEmail: true, partnerVoice: true, channelSlug: true,
        brief: true, url: true, assetUrl: true, targetKeyword: true, topicCluster: true,
        segment: true, serviceLine: true, tags: true,
        importId: true, approvedAt: true,
      },
    }),
    // Newest first: the calendar on screen is the one the latest import left behind, and
    // an older import for the same month has been replaced.
    db().contentImport.findMany({
      where: { month },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pieces: true } } },
    }),
  ]);

  const mapped: CalendarPiece[] = pieces.map((p) => ({
    id: p.id,
    title: p.title,
    format: p.format,
    assetShape: p.assetShape,
    publishMinute: p.publishMinute,
    status: p.status,
    // Non-null by the query: the month is a range filter on this column.
    publishDate: p.publishDate as Date,
    authorEmail: p.authorEmail,
    designerEmail: p.designerEmail,
    partnerVoice: p.partnerVoice,
    channelSlug: p.channelSlug,
    brief: p.brief,
    url: p.url,
    assetUrl: p.assetUrl,
    targetKeyword: p.targetKeyword,
    topicCluster: p.topicCluster,
    segment: p.segment,
    serviceLine: p.serviceLine,
    tags: p.tags,
    imported: p.importId !== null,
    approved: p.approvedAt !== null,
  }));

  const byDay = new Map<number, CalendarPiece[]>();
  for (const piece of mapped) {
    const day = piece.publishDate.getUTCDate();
    const list = byDay.get(day);
    if (list) list.push(piece);
    else byDay.set(day, [piece]);
  }

  // getUTCDay() is 0 for Sunday; Monday-first wants Sunday last.
  const firstWeekday = (month.getUTCDay() + 6) % 7;
  const total = daysInMonth(month);

  const days: CalendarDay[] = [];
  for (let i = 0; i < firstWeekday; i++) days.push({ date: null, pieces: [] });
  for (let day = 1; day <= total; day++) {
    days.push({
      date: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)),
      pieces: byDay.get(day) ?? [],
    });
  }
  while (days.length % 7 !== 0) days.push({ date: null, pieces: [] });

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const latest = imports[0] ?? null;

  return {
    month,
    monthKey: monthKey(month),
    label: monthLabel(month),
    weeks,
    pieces: mapped,
    counts: {
      total: mapped.length,
      imported: mapped.filter((p) => p.imported).length,
      byHand: mapped.filter((p) => !p.imported).length,
      published: mapped.filter((p) => p.status === 'published').length,
    },
    lastImport: latest
      ? ({
          id: latest.id,
          importedByEmail: latest.importedByEmail,
          fileName: latest.fileName,
          fileFormat: latest.fileFormat,
          rowsRead: latest.rowsRead,
          created: latest.created,
          skipped: latest.skipped,
          skippedReasons: latest.skippedReasons,
          createdAt: latest.createdAt,
          remaining: latest._count.pieces,
        } satisfies CalendarImport)
      : null,
    /** Every import this month has had, so a replacement does not erase the record of one. */
    importCount: imports.length,
  };
}

// ── Importing ─────────────────────────────────────────────────────────────────────────

export type ImportSummary = {
  importId: string;
  month: MonthKey;
  rowsRead: number;
  created: number;
  skipped: number;
  skippedReasons: string[];
  unmappedHeaders: string[];
  unresolvedPeople: string[];
  /** Pieces removed by a replace, and the ones it refused to remove. */
  replaced: number;
  keptPublished: number;
};

/**
 * Writes a read sheet into the month.
 *
 * `replace` is what the Replace button sends. It removes the pieces earlier imports left
 * in this month and nothing else: a piece somebody added by hand is not part of the
 * calendar that arrived in a file, and deleting it because a spreadsheet was uploaded
 * again would be the application throwing away work it was never given.
 *
 * Published pieces survive a replace even though they were imported. By the time a piece
 * is published it has a URL, an approval and — through the metrics join — views and leads
 * against it. That is no longer a plan, and re-uploading September's spreadsheet is not a
 * reason to lose it. The count is returned so the caller can say so out loud.
 *
 * One transaction: a replace that deleted the old calendar and then failed to write the
 * new one would leave the month empty, which is worse than either outcome.
 */
export async function importCalendar(input: {
  month: Date;
  sheet: SheetRead;
  fileName: string;
  fileFormat: 'csv' | 'xlsx';
  actorEmail: string;
  replace: boolean;
}): Promise<ImportSummary> {
  const { month, sheet, fileName, fileFormat, actorEmail, replace } = input;
  const { from, to } = monthRange(month);

  const result = await db().$transaction(async (tx) => {
    let replaced = 0;
    let keptPublished = 0;

    if (replace) {
      const previous = await tx.contentPiece.findMany({
        where: { publishDate: { gte: from, lt: to }, importId: { not: null } },
        select: { id: true, status: true },
      });
      const removable = previous.filter((p) => p.status !== 'published' && p.status !== 'repurposed');
      keptPublished = previous.length - removable.length;

      if (removable.length) {
        const { count } = await tx.contentPiece.deleteMany({
          where: { id: { in: removable.map((p) => p.id) } },
        });
        replaced = count;
      }

      // The old provenance rows go with their pieces; the ones that kept a published
      // piece stay, because that piece still came from somewhere and the row is the only
      // thing that says where.
      await tx.contentImport.deleteMany({ where: { month, pieces: { none: {} } } });
    }

    const record = await tx.contentImport.create({
      data: {
        month,
        importedByEmail: actorEmail,
        fileName: fileName.slice(0, 260),
        fileFormat,
        rowsRead: sheet.rowsRead,
        created: sheet.rows.length,
        skipped: sheet.skippedReasons.length,
        // Capped: a file with 500 broken rows should not put 500 lines in a row nobody
        // can read. The count above is the whole truth; these are the examples.
        skippedReasons: sheet.skippedReasons.slice(0, 50),
      },
      select: { id: true },
    });

    if (sheet.rows.length) {
      await tx.contentPiece.createMany({
        data: sheet.rows.map((row) => ({
          ...row,
          importId: record.id,
          // §15.4's provenance column. An imported piece is neither a person's idea nor a
          // sync's discovery, and the board reads differently if you cannot tell.
          createdBy: 'calendar_import',
        })),
      });
    }

    return { importId: record.id, replaced, keptPublished };
  },
  // Prisma's defaults are a 2-second wait for the connection and a 5-second transaction,
  // and neither fits a hosted Postgres: acquiring a connection from a serverless compute
  // that has been idle takes longer than two seconds, which is how this first failed —
  // P2028, "unable to start a transaction in the given time", before a single row was
  // read. The same numbers lib/ai/ai.ts arrived at for the same reason.
  { timeout: 30_000, maxWait: 10_000 });

  await recordAudit({
    actorEmail,
    action: replace ? 'content.calendar_replace' : 'content.calendar_import',
    entityType: 'content_import',
    entityId: result.importId,
    detail: {
      month: monthKey(month),
      fileName,
      fileFormat,
      rowsRead: sheet.rowsRead,
      created: sheet.rows.length,
      skipped: sheet.skippedReasons.length,
      replaced: result.replaced,
      keptPublished: result.keptPublished,
    },
  
  });

  return {
    importId: result.importId,
    month: monthKey(month),
    rowsRead: sheet.rowsRead,
    created: sheet.rows.length,
    skipped: sheet.skippedReasons.length,
    skippedReasons: sheet.skippedReasons.slice(0, 50),
    unmappedHeaders: sheet.unmappedHeaders,
    unresolvedPeople: sheet.unresolvedPeople,
    replaced: result.replaced,
    keptPublished: result.keptPublished,
  };
}

// ── Exporting ─────────────────────────────────────────────────────────────────────────

/**
 * The columns an export writes, in order.
 *
 * The same names the import reads, so a calendar exported from here, edited in Sheets and
 * uploaded again round-trips without anybody renaming a column. That is the property
 * worth having: the export is how you get a template.
 */
export const EXPORT_HEADERS = [
  'Date', 'Time', 'Title', 'Format', 'Asset shape', 'Status', 'Author', 'Designer',
  'Partner voice', 'Channel', 'Topic cluster', 'Segment', 'Service line', 'Target keyword',
  'Brief', 'URL', 'Asset', 'Tags', 'Views', 'Leads',
] as const;

export async function calendarRowsForExport(month: Date) {
  const { from, to } = monthRange(month);
  const pieces = await db().contentPiece.findMany({
    where: { publishDate: { gte: from, lt: to } },
    orderBy: [
      { publishDate: 'asc' },
      { publishMinute: { sort: 'asc', nulls: 'last' } },
      { title: 'asc' },
    ],
    select: {
      publishDate: true, publishMinute: true, title: true, format: true, assetShape: true,
      status: true, authorEmail: true,
      designerEmail: true, partnerVoice: true, channelSlug: true, topicCluster: true,
      segment: true, serviceLine: true, targetKeyword: true, brief: true, url: true,
      assetUrl: true, tags: true, views: true, leadsGenerated: true,
    },
  });

  return pieces.map((p) => [
    p.publishDate ? p.publishDate.toISOString().slice(0, 10) : '',
    // "9:30 AM" rather than 570: the export is read by people, and `parseSlot` reads it
    // straight back on the way in.
    formatSlot(p.publishMinute) ?? '',
    p.title,
    p.format,
    p.assetShape ?? '',
    p.status,
    p.authorEmail ?? '',
    p.designerEmail ?? '',
    p.partnerVoice ?? '',
    p.channelSlug ?? '',
    p.topicCluster ?? '',
    p.segment ?? '',
    p.serviceLine ?? '',
    p.targetKeyword ?? '',
    p.brief ?? '',
    p.url ?? '',
    p.assetUrl ?? '',
    p.tags.join('; '),
    String(p.views),
    String(p.leadsGenerated),
  ]);
}

/** ISO dates and a header row, through the escaping in lib/csv.ts. */
export async function calendarCsv(month: Date): Promise<string> {
  const rows = await calendarRowsForExport(month);
  return csvDocument([csvRow([...EXPORT_HEADERS]), ...rows.map((r) => csvRow(r))]);
}
