import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Control characters standing in for regex escapes.
//
// e2e/rebalance.spec.ts carried two literal backspace bytes where a word boundary had
// been meant, so its pattern asked for a control character either side of the digits and
// could never match. The assertion passed on every run and checked nothing. Writing the
// fix, the same slip was made twice more in this directory within the hour.
//
// It is invisible in every editor and in every diff, survives review, and turns an
// assertion into decoration. One byte scan is cheaper than noticing it a fourth time.

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.next', '.git', 'generated', 'test-results', 'screenshots']);

/**
 * Bytes that have no business in source and are exactly what the common regex escapes
 * collapse to when something interprets them a layer too early.
 *
 *   \b -> 0x08   \f -> 0x0c   \v -> 0x0b   \a -> 0x07   \e -> 0x1b   \0 -> 0x00
 *
 * Tab (0x09), newline (0x0a) and carriage return (0x0d) are deliberately absent: they are
 * ordinary text here.
 */
const FORBIDDEN = new Map<number, string>([
  [0x00, 'NUL'],
  [0x07, 'BEL'],
  [0x08, 'BACKSPACE'],
  [0x0b, 'VERTICAL TAB'],
  [0x0c, 'FORM FEED'],
  [0x1b, 'ESCAPE'],
]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sources(ROOT);

test('the scan has files to look at', () => {
  assert.ok(files.length > 100, `expected the whole repository, found ${files.length}`);
});

test('no source file contains a control character where an escape was meant', () => {
  const offenders: string[] = [];

  for (const file of files) {
    const bytes = readFileSync(file);
    for (let i = 0; i < bytes.length; i++) {
      const name = FORBIDDEN.get(bytes[i]);
      if (!name) continue;

      // Report the line and what surrounds it: the byte itself prints as nothing, so the
      // only way to see where it is, is to be told.
      const line = bytes.subarray(0, i).toString('utf8').split('\n').length;
      const context = bytes
        .subarray(Math.max(0, i - 40), i + 20)
        .toString('utf8')
        .replace(/[\u0000-\u0008\u000b\u000c\u001b]/g, '\u2421');
      offenders.push(`${file.slice(ROOT.length + 1).split(sep).join('/')}:${line} ${name} in "${context}"`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a literal control character is in the source; it was almost certainly meant to be a regex escape such as \b',
  );
});
