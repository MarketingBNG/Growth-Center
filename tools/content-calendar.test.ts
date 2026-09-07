import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvParse } from '../lib/csv.ts';
import {
  EXPORT_HEADERS,
  mapHeaders,
  monthLabel,
  parseCalendarDate,
  parseMonth,
  readFormat,
  readSheet,
  readStatus,
} from '../lib/content-calendar.ts';

// The content board could only be filled by hand — its own empty state said so — and a
// month's calendar is always already written, in a spreadsheet, by whoever planned it.
// These cover the reading of that file, which is the part that fails quietly: a column
// this app does not recognise, or a date it reads the wrong way round, produces an import
// that looks like it worked.

const SEP = parseMonth('2026-09')!;

// ── The CSV reader ────────────────────────────────────────────────────────────────────

test('a quoted field keeps its commas, quotes and newlines', () => {
  const rows = csvParse('a,"b, still b","he said ""hi""","two\nlines"');
  assert.deepEqual(rows, [['a', 'b, still b', 'he said "hi"', 'two\nlines']]);
});

test('CRLF, LF and a bare CR are each one line break', () => {
  assert.equal(csvParse('a\r\nb\nc\rd').length, 4);
});

test('the byte-order mark is not part of the first header', () => {
  // csvDocument writes one, and so does Excel. Without this the first column is called
  // "﻿Date" and nothing maps to the date field.
  const [header] = csvParse('﻿Date,Title\n2026-09-01,Hello');
  assert.equal(header[0], 'Date');
});

test('a file that ends in a newline does not gain an empty row', () => {
  assert.equal(csvParse('a,b\r\nc,d\r\n').length, 2);
});

test('ragged rows come back as they are', () => {
  // Sheets writes short rows for trailing empty cells. Deciding what a missing cell means
  // belongs to the reader that knows what the column was.
  assert.deepEqual(csvParse('a,b,c\n1\n2,3'), [['a', 'b', 'c'], ['1'], ['2', '3']]);
});

// ── Dates ────────────────────────────────────────────────────────────────────────────

test('an ISO date is read as itself', () => {
  assert.equal(parseCalendarDate('2026-09-12', SEP)?.toISOString().slice(0, 10), '2026-09-12');
});

test('a slashed date is read day-first, which is how they are written here', () => {
  // 04/09/2026 is the 4th of September, not the 9th of April. The firm is in India and
  // its calendars are written in the local convention.
  assert.equal(parseCalendarDate('04/09/2026', SEP)?.toISOString().slice(0, 10), '2026-09-04');
});

test('a first number over 12 settles the reading on its own', () => {
  assert.equal(parseCalendarDate('25/09/2026', SEP)?.toISOString().slice(0, 10), '2026-09-25');
  // Month-first, because 25 cannot be a month and the other reading works.
  assert.equal(parseCalendarDate('09/25/2026', SEP)?.toISOString().slice(0, 10), '2026-09-25');
});

test('a bare day number is a day of the month being imported', () => {
  // The commonest shape there is: a calendar for one month numbers its rows 1 to 30 and
  // says the month once, in a heading or the file name.
  assert.equal(parseCalendarDate('12', SEP)?.toISOString().slice(0, 10), '2026-09-12');
  assert.equal(parseCalendarDate(12, SEP)?.toISOString().slice(0, 10), '2026-09-12');
  assert.equal(parseCalendarDate('3rd', SEP)?.toISOString().slice(0, 10), '2026-09-03');
});

test('a named month is read either way round', () => {
  assert.equal(parseCalendarDate('12 Sep', SEP)?.toISOString().slice(0, 10), '2026-09-12');
  assert.equal(parseCalendarDate('Sep 12, 2026', SEP)?.toISOString().slice(0, 10), '2026-09-12');
  assert.equal(parseCalendarDate('1st October 2026', SEP)?.toISOString().slice(0, 10), '2026-10-01');
});

test('a Date and an Excel serial both arrive as the day they mean', () => {
  // exceljs hands back a real Date for a date-formatted cell, which is the common case in
  // an .xlsx and needs no parsing at all.
  const cell = new Date(Date.UTC(2026, 8, 12));
  assert.equal(parseCalendarDate(cell, SEP)?.toISOString().slice(0, 10), '2026-09-12');
  // Whole days since 1899-12-30. 46277 is 2026-09-12.
  assert.equal(parseCalendarDate(46_277, SEP)?.toISOString().slice(0, 10), '2026-09-12');
});

test('an impossible date is refused rather than rolled forward', () => {
  // Date.UTC would happily make 31 February into 3 March, which is how a typo becomes a
  // piece scheduled in a month nobody was looking at.
  assert.equal(parseCalendarDate('31/02/2026', SEP), null);
  assert.equal(parseCalendarDate('nope', SEP), null);
  assert.equal(parseCalendarDate('', SEP), null);
});

// ── Headers ──────────────────────────────────────────────────────────────────────────

test('a header is matched on its letters, however it is punctuated', () => {
  const { columns } = mapHeaders(['Publish Date', 'publish_date', 'TITLE', 'Content-Type']);
  assert.equal(columns.publishDate, 0, 'the left-most of two date columns wins');
  assert.equal(columns.title, 2);
  assert.equal(columns.format, 3);
});

test('an unrecognised header is reported, never silently dropped', () => {
  // A calendar whose "Topic" column this app read as nothing would import 30 untitled
  // pieces and look like it had worked.
  const { unmapped } = mapHeaders(['Date', 'Title', 'Boost budget', 'Approved by client']);
  assert.deepEqual(unmapped, ['Boost budget', 'Approved by client']);
});

test('an export round-trips: every column it writes is one the import reads or ignores', () => {
  // The property that makes the export the template. If this fails, a calendar exported
  // from here, edited in Sheets and uploaded again loses a column.
  const { columns, unmapped } = mapHeaders([...EXPORT_HEADERS]);
  assert.deepEqual(unmapped, [], 'an export header that maps to nothing');
  for (const field of ['publishDate', 'title', 'format', 'status', 'authorEmail', 'brief', 'tags'] as const) {
    assert.notEqual(columns[field], undefined, `${field} is not read back`);
  }
});

test('the performance columns are recognised and refused', () => {
  // Views and leads are written by the metrics join. Reported as neither read nor
  // surprising, so a round-tripped export does not warn about them every time.
  const { columns, unmapped } = mapHeaders(['Date', 'Title', 'Views', 'Leads']);
  assert.deepEqual(unmapped, []);
  assert.equal(Object.keys(columns).length, 2);
});

// ── Vocabularies ─────────────────────────────────────────────────────────────────────

test('the words a calendar uses map onto the format column', () => {
  assert.equal(readFormat('Reel'), 'video');
  assert.equal(readFormat('Carousel'), 'social');
  assert.equal(readFormat('Newsletter'), 'email');
  assert.equal(readFormat('Case Study'), 'case_study');
  assert.equal(readFormat('Landing Page'), 'landing_page');
  // Unrecognised falls back rather than refusing the row: the shape of an asset is not
  // what a calendar is for.
  assert.equal(readFormat('interpretive dance'), 'blog');
});

test('a type cell that names both an asset and a network is read as the asset', () => {
  // Real calendars write both in one cell. Reading left to right and stopping at the
  // first recognised word files "Instagram Reel" as a social post.
  assert.equal(readFormat('Instagram Reel'), 'video');
  assert.equal(readFormat('YouTube Short'), 'video');
  assert.equal(readFormat('LinkedIn Carousel'), 'social');
  assert.equal(readFormat('Email Newsletter'), 'email');
  // A cell that names only a place still says something.
  assert.equal(readFormat('LinkedIn'), 'social');
  assert.equal(readFormat('YouTube'), 'video');
});

test('a status is read from the stored value, the board label, or a spreadsheet word', () => {
  assert.equal(readStatus('partner_approval'), 'partner_approval');
  assert.equal(readStatus('Partner approval'), 'partner_approval');
  assert.equal(readStatus('Planned'), 'idea');
  assert.equal(readStatus('Live'), 'published');
  assert.equal(readStatus('WIP'), 'draft');
  assert.equal(readStatus('something else'), null);
});

// ── A whole sheet ────────────────────────────────────────────────────────────────────

const SHEET = [
  ['Content Calendar — September 2026'],
  [],
  ['Date', 'Title', 'Type', 'Owner', 'Notes', 'Boost budget'],
  ['2026-09-02', 'Q3 tax recap', 'Blog', 'shweta@usaindiacfo.com', 'Pull the numbers first', '0'],
  ['4', 'Reel: GST changes', 'Reel', 'Abhuday', '', ''],
  [],
  ['2026-10-01', 'October opener', 'Blog', '', '', ''],
  ['', 'No date at all', 'Blog', '', '', ''],
  ['2026-09-09', '', 'Blog', '', '', ''],
];

test('the header row is hunted for, not assumed to be the first', () => {
  // A calendar exported from Sheets very often starts with a merged title cell and a
  // blank row. Assuming row 1 would find no columns and import nothing.
  const read = readSheet(SHEET, SEP);
  assert.equal(read.rows.length, 2);
  assert.deepEqual(read.rows.map((r) => r.title), ['Q3 tax recap', 'Reel: GST changes']);
});

test('a bare day is resolved against the month, and aliases fill the fields', () => {
  const [, reel] = readSheet(SHEET, SEP).rows;
  assert.equal(reel.publishDate.toISOString().slice(0, 10), '2026-09-04');
  assert.equal(reel.format, 'video');
  assert.equal(readSheet(SHEET, SEP).rows[0].brief, 'Pull the numbers first');
});

test('a row outside the month is refused with the date it had', () => {
  // The month is asked for rather than inferred, so a file uploaded as the wrong month
  // fails loudly instead of scattering a month of posts into one nobody is looking at.
  const { skippedReasons } = readSheet(SHEET, SEP);
  assert.ok(
    skippedReasons.some((r) => r.includes('2026-10-01') && r.includes('outside September 2026')),
    skippedReasons.join(' | '),
  );
});

test('no date and no title are the only two reasons a row is refused', () => {
  const { skippedReasons, rowsRead } = readSheet(SHEET, SEP);
  assert.equal(rowsRead, 5, 'the blank row between weeks is not a failed import');
  assert.equal(skippedReasons.length, 3);
  assert.ok(skippedReasons.some((r) => r.includes('no date')));
  assert.ok(skippedReasons.some((r) => r.includes('no title')));
  // Spreadsheet row numbers, one-based, so a reason can be acted on in the file itself.
  assert.ok(skippedReasons.every((r) => /^Row \d+/.test(r)));
});

test('an owner without an email is reported rather than quietly dropped', () => {
  // Otherwise the calendar imports with nobody assigned to anything and the person who
  // uploaded it finds out a week later.
  const read = readSheet(SHEET, SEP);
  assert.deepEqual(read.unresolvedPeople, ['Abhuday']);
  assert.equal(read.rows[0].authorEmail, 'shweta@usaindiacfo.com');
  assert.equal(read.rows[1].authorEmail, null);
});

test('a file with no title-and-date header says so instead of importing nothing', () => {
  const read = readSheet([['Week', 'Budget'], ['1', '400']], SEP);
  assert.equal(read.rows.length, 0);
  assert.match(read.skippedReasons[0], /No header row found/);
});

test('a month is spoken and parsed the same way', () => {
  assert.equal(monthLabel(SEP), 'September 2026');
  assert.equal(parseMonth('2026-13'), null);
  assert.equal(parseMonth('nope'), null);
  assert.equal(parseMonth('2026-09')?.toISOString(), '2026-09-01T00:00:00.000Z');
});
