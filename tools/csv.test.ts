import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, csvDocument, csvRow } from '../lib/csv.ts';

// The export is opened in Excel by a finance team, and its cells carry company, campaign
// and keyword text straight from whatever the CRM contains.

test('a plain value is written as-is', () => {
  assert.equal(csvCell('Acme Ltd'), 'Acme Ltd');
  assert.equal(csvCell(''), '');
});

test('commas, quotes and newlines keep the field intact', () => {
  assert.equal(csvCell('Smith, Jones & Co'), '"Smith, Jones & Co"');
  assert.equal(csvCell('He said "hello"'), '"He said ""hello"""');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
});

test('a value that a spreadsheet would run as a formula is neutralised', () => {
  // Excel, Sheets and LibreOffice all evaluate these. The name arrives from the CRM, so
  // nobody here chose it, and the reader is the one whose machine runs it.
  assert.equal(csvCell('=cmd|\'/c calc\'!A1'), "'=cmd|'/c calc'!A1");
  assert.equal(csvCell('+1+1'), "'+1+1");
  assert.equal(csvCell('-1+1'), "'-1+1");
  assert.equal(csvCell('@SUM(A1:A9)'), "'@SUM(A1:A9)");
  assert.equal(csvCell('\tsomething'), "'\tsomething");
});

test('a neutralised value is still quoted when it needs to be', () => {
  // Both problems at once: it starts with = and contains a comma.
  assert.equal(csvCell('=A1,B2'), '"\'=A1,B2"');
});

test('a negative number is protected too, because a spreadsheet cannot tell them apart', () => {
  // Costs the minus sign its bare form, which is the right trade against running a
  // formula. Figures are formatted before they reach here anyway.
  assert.equal(csvCell('-250'), "'-250");
});

test('a row joins escaped cells and tolerates missing ones', () => {
  assert.equal(csvRow(['a', null, undefined, 'b,c']), 'a,,,"b,c"');
});

test('the document is CRLF and carries a byte-order mark', () => {
  // Without the mark Excel reads UTF-8 as Latin-1 and mangles every currency symbol.
  assert.equal(csvDocument(['a', 'b']), '\uFEFFa\r\nb');
});
