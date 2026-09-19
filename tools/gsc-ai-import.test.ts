import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_IMPORT_SOURCE,
  AI_IMPRESSIONS_KEY,
  AiImportError,
  parseAiExport,
  parseNumber,
} from '../lib/analytics/gsc-ai-import.ts';

// Search Console's AI performance export.
//
// There is no API for this report, so the file a person uploads is the only path these
// numbers have into the application. Everything here is about the two ways that goes
// wrong quietly: the wrong tab of the right report, and a locale that writes numbers
// differently from the one the code was written in.

const csv = (...lines: string[]) => lines.join('\n');

const GOOD = csv(
  'Page,Clicks,Impressions,CTR,Position',
  'https://usaindiacfo.com/,12,3400,0.35%,4.2',
  'https://usaindiacfo.com/services/,3,890,0.34%,7.9',
);

test('a normal export is read', () => {
  const { rows, skipped } = parseAiExport(GOOD);
  assert.equal(rows.length, 2);
  assert.equal(skipped.length, 0);
  assert.deepEqual(rows[0], {
    url: 'https://usaindiacfo.com/',
    impressions: 3400,
    clicks: 12,
    position: 4.2,
  });
});

test('the source and metric names are fixed, because rows are found by them later', () => {
  assert.equal(AI_IMPORT_SOURCE, 'gsc_ai_export');
  assert.equal(AI_IMPRESSIONS_KEY, 'ai_impressions');
});

// ── rejecting the wrong file ─────────────────────────────────────────────────────────

// The failure this whole module is shaped around. The Queries export has the same column
// names and parses perfectly; without a check, a list of search terms is filed as a list
// of pages and the SEO tables fill with rows like "us india tax".
test('the Queries export is rejected rather than filed as pages', () => {
  // Caught on the header: the Queries tab has no page column at all.
  assert.throws(
    () =>
      parseAiExport(
        csv('Query,Clicks,Impressions', 'us india tax,4,900', 'form 5471 help,2,300'),
      ),
    (e: Error) => e instanceof AiImportError && /no page column/.test(e.message),
  );
});

// The nastier version: a file whose column IS called Page but holds search terms, which a
// header check alone cannot catch. This is what the per-row URL test is for.
test('search terms under a Page header are rejected, not stored as URLs', () => {
  assert.throws(
    () => parseAiExport(csv('Page,Impressions', 'us india tax,900', 'form 5471 help,300')),
    (e: Error) => e instanceof AiImportError && /Queries export rather than Pages/.test(e.message),
  );
});

test('a file with no page column says so and lists what it found', () => {
  assert.throws(
    () => parseAiExport(csv('Date,Clicks,Impressions', '2026-09-01,4,900')),
    (e: Error) =>
      e instanceof AiImportError &&
      /no page column/.test(e.message) &&
      /Date, Clicks, Impressions/.test(e.message),
  );
});

test('a file with pages but no impressions is rejected', () => {
  assert.throws(
    () => parseAiExport(csv('Page,Clicks', 'https://a.com/,4')),
    (e: Error) => e instanceof AiImportError && /no impressions column/.test(e.message),
  );
});

test('an empty file is rejected, not imported as nothing', () => {
  assert.throws(() => parseAiExport(''), /empty/i);
  assert.throws(() => parseAiExport('Page,Impressions'), /headers but no rows/);
});

// ── matching Google's column names ───────────────────────────────────────────────────

test('the headers Google actually ships are all matched', () => {
  for (const header of ['Page', 'Top pages', 'URL', 'Landing Page', 'Address']) {
    const { rows } = parseAiExport(csv(`${header},Impressions`, 'https://a.com/,10'));
    assert.equal(rows.length, 1, `${header} was not recognised as the page column`);
  }
});

test('a byte-order mark and stray whitespace do not hide the first header', () => {
  const { rows } = parseAiExport(csv('﻿  Page  ,  Impressions  ', 'https://a.com/,10'));
  assert.equal(rows[0].impressions, 10);
});

test("a footnote marker on Google's header is not part of the name", () => {
  const { rows } = parseAiExport(csv('Page,Impressions*', 'https://a.com/,10'));
  assert.equal(rows[0].impressions, 10);
});

// A file with both columns is the dangerous one: matched loosely, "Impressions" would win
// on a startsWith pass and ordinary search impressions would be stored as AI ones.
test('AI impressions win over plain impressions when a file has both', () => {
  const { rows, matched } = parseAiExport(
    csv('Page,Impressions,AI impressions', 'https://a.com/,9999,42'),
  );
  assert.equal(rows[0].impressions, 42);
  assert.equal(matched.impressions, 'AI impressions');
});

// ── numbers as spreadsheets write them ───────────────────────────────────────────────

test('thousands separators survive the trip', () => {
  // Ambiguous on its own — 1234 to an American, 1.234 to a German. Three digits after the
  // comma and no dot is read as a thousands separator, which is the usual convention and
  // the only reading that is a plausible impression count.
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('1,234,567'), 1234567);
});

test('a European decimal comma is not read as a thousands separator', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56, 'German export: 1234.56, not 1.23456');
  assert.equal(parseNumber('4,2'), 4.2);
  assert.equal(parseNumber('1,234.56'), 1234.56, 'and the other convention still works');
});

test('a percent sign and padding are stripped', () => {
  assert.equal(parseNumber(' 0.35% '), 0.35);
});

test('a cell that is not a number is null, never NaN', () => {
  assert.equal(parseNumber('n/a'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('—'), null);
});

// ── rows it skips rather than rejects ────────────────────────────────────────────────

test('a bad row is skipped with a line number, and the rest still import', () => {
  const { rows, skipped } = parseAiExport(
    csv(
      'Page,Impressions',
      'https://a.com/good,10',
      'https://a.com/bad,not a number',
      'https://a.com/also-good,20',
    ),
  );
  assert.equal(rows.length, 2);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 3, 'the line number a spreadsheet would show');
  assert.match(skipped[0].reason, /not a number/);
});

// Google puts a totals row on some exports. Stored, it becomes a phantom page carrying the
// traffic of the whole site and outranks everything real in the table.
test('a repeated URL is imported once', () => {
  const { rows, skipped } = parseAiExport(
    csv('Page,Impressions', 'https://a.com/x,10', 'https://a.com/x,999'),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].impressions, 10);
  assert.match(skipped[0].reason, /more than once/);
});

test('negative impressions are refused rather than stored', () => {
  const { rows, skipped } = parseAiExport(
    csv('Page,Impressions', 'https://a.com/x,-5', 'https://a.com/y,5'),
  );
  assert.equal(rows.length, 1);
  assert.match(skipped[0].reason, /negative/);
});

test('blank lines in the middle of a file are not rows', () => {
  const { rows, skipped } = parseAiExport(
    csv('Page,Impressions', 'https://a.com/x,10', '', '', 'https://a.com/y,20'),
  );
  assert.equal(rows.length, 2);
  assert.equal(skipped.length, 0);
});

test('a relative path counts as a page', () => {
  const { rows } = parseAiExport(csv('Page,Impressions', '/services/,10'));
  assert.equal(rows[0].url, '/services/');
});

test('clicks and position are optional, not invented', () => {
  const { rows } = parseAiExport(csv('Page,Impressions', 'https://a.com/,10'));
  assert.equal(rows[0].clicks, null);
  assert.equal(rows[0].position, null);
});

test('a quoted URL containing a comma stays one cell', () => {
  const { rows } = parseAiExport(
    csv('Page,Impressions', '"https://a.com/a,b",10'),
  );
  assert.equal(rows[0].url, 'https://a.com/a,b');
  assert.equal(rows[0].impressions, 10);
});
