import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libSource, relative, source, walk, ROOT } from './source.ts';
import { join } from 'node:path';

// What this file is really guarding is the silent failure. Twenty-five tests assert on
// source text they did not have to name a path for; if the locator ever answered "" for a
// name it could not find, every one of those assertions would pass against nothing and
// report that the code was fine.

test('a module is found by its basename', () => {
  const text = libSource('insight-rules');
  assert.match(text, /export/);
  assert.ok(text.length > 1000, 'read the whole file, not a fragment');
});

test('a nested module is found by either name', () => {
  assert.equal(libSource('metrics/core'), libSource('core'));
});

test('the .ts suffix and a lib/ prefix are both tolerated', () => {
  const plain = libSource('leads');
  assert.equal(libSource('leads.ts'), plain);
  assert.equal(libSource('lib/leads'), plain);
  assert.equal(libSource('lib/leads.ts'), plain);
});

test('an unknown module throws instead of returning nothing', () => {
  // The whole point. An empty string here would make `assert.match(source, /anything/)`
  // fail loudly, but `assert.equal(source.includes('x'), false)` pass silently for ever.
  assert.throws(
    () => libSource('no-such-module-exists'),
    /No lib module named "no-such-module-exists"/,
  );
});

test('an exact path beats a shared basename', () => {
  // lib/leads.ts and lib/reports/leads.ts share a basename, so "leads" would be ambiguous
  // — except that it is also the exact path of the first, which is what it must resolve to.
  assert.notEqual(libSource('leads'), libSource('reports/leads'));
  assert.equal(libSource('leads'), libSource('lib/leads.ts'));
});

test('an ambiguous name throws and names the candidates', () => {
  // A basename shared by two nested modules, where neither is the whole path: the locator
  // cannot know which was meant, and picking one is a silent wrong answer.
  const byBase = new Map<string, string[]>();
  const paths = new Set<string>();
  for (const f of walk(join(ROOT, 'lib'), ['.ts'])) {
    const path = relative(f).replace(/^lib\//, '').replace(/\.ts$/, '');
    paths.add(path);
    const base = path.split('/').pop()!;
    byBase.set(base, [...(byBase.get(base) ?? []), f]);
  }
  const shared = [...byBase].find(([base, fs]) => fs.length > 1 && !paths.has(base));

  if (shared) assert.throws(() => libSource(shared[0]), /matches \d+ modules/);
  // Otherwise no such collision exists today. Assert the refusal is still in the code
  // rather than skipping, so deleting it fails here instead of going unnoticed.
  else assert.match(libSource.toString(), /matches \$\{found\.length\} modules/);
});

test('source() reads a file that is not a lib module', () => {
  assert.match(source('prisma/schema.prisma'), /model /);
  assert.throws(() => source('nowhere/at/all.ts'), /No file at/);
});

test('walk skips the directories that are not source', () => {
  const files = walk(join(ROOT, 'lib'), ['.ts']).map(relative);
  assert.ok(files.length > 100, `expected the whole of lib/, found ${files.length}`);
  assert.equal(
    files.some((f) => f.includes('generated')),
    false,
    'the generated Prisma client is not source',
  );
  assert.ok(files.some((f) => f.includes('/')), 'walk recurses into subdirectories');
});
