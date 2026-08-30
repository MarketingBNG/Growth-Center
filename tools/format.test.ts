import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtCompact,
  fmtDays,
  fmtDuration,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  fmtPercent,
  fmtRatio,
  safeUrl,
} from '../lib/format.ts';

// Every formatter is on screen somewhere, and the null paths are load-bearing: "—" is
// how the app says "no data" instead of implying zero.

test('null and undefined render as an em dash, never as zero', () => {
  for (const f of [fmtMoney, fmtCompact, fmtNumber, fmtPercent, fmtRatio, fmtDuration, fmtDays]) {
    assert.equal(f(null), '—', `${f.name}(null)`);
    assert.equal(f(undefined), '—', `${f.name}(undefined)`);
  }
  assert.equal(fmtMoneyCompact(null), '—');
});

test('NaN is treated as no data rather than printed', () => {
  assert.equal(fmtMoney(NaN), '—');
  assert.equal(fmtPercent(NaN), '—');
  assert.equal(fmtDuration(NaN), '—');
});

test('zero is a real value and still renders', () => {
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtNumber(0), '0');
  assert.equal(fmtPercent(0), '0.00%');
  assert.equal(fmtMoneyCompact(0), '$0');
});

test('small rates get more precision, so 0.34% is not shown as 0.3%', () => {
  assert.equal(fmtPercent(0.34), '0.34%');
  assert.equal(fmtPercent(28.6), '28.6%');
  // An explicit digit count wins over the automatic rule.
  assert.equal(fmtPercent(28.6, 2), '28.60%');
});

test('fmtMoneyCompact stays short enough for a 46px axis gutter', () => {
  // The long form overflowed and was clipped mid-number, which read as a wrong value.
  assert.equal(fmtMoneyCompact(240_000), '$240K');
  assert.equal(fmtMoneyCompact(1_500_000), '$2M');
  for (const v of [1000, 60_000, 240_000, 999_000]) {
    assert.ok(fmtMoneyCompact(v).length <= 7, `${v} -> ${fmtMoneyCompact(v)} is too wide`);
  }
});

test('fmtDuration drops to minutes under an hour and to days past two', () => {
  assert.equal(fmtDuration(0.2), '12m');
  assert.equal(fmtDuration(3.2), '3h 12m');
  assert.equal(fmtDuration(5), '5h');
  assert.equal(fmtDuration(72), '3d');
});

test('fmtDays singularises one day', () => {
  assert.equal(fmtDays(1), '1 day');
  assert.equal(fmtDays(2.7), '3 days');
});

test('fmtCompact abbreviates only above a thousand', () => {
  assert.equal(fmtCompact(999), '999');
  assert.equal(fmtCompact(16_711), '16.7K');
});

test('safeUrl passes an ordinary link through', () => {
  assert.equal(safeUrl('https://example.com/post'), 'https://example.com/post');
  assert.equal(safeUrl('http://example.com/'), 'http://example.com/');
});

test('safeUrl gives a bare domain a scheme rather than making it a relative path', () => {
  assert.equal(safeUrl('linkedin.com/in/someone'), 'https://linkedin.com/in/someone');
  assert.equal(safeUrl('  example.com  '), 'https://example.com/');
});

test('safeUrl refuses a script URL however it is dressed up', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('JavaScript:alert(1)'), null);
  assert.equal(safeUrl('  javascript:alert(1)  '), null);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('vbscript:msgbox(1)'), null);
});

test('safeUrl returns null for nothing at all', () => {
  assert.equal(safeUrl(null), null);
  assert.equal(safeUrl(undefined), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl('   '), null);
});
