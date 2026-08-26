import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_SOURCE,
  INTERNAL_SOURCE,
  KNOWN_SOURCES,
  isLiveSource,
  isSeeded,
  sourceMeta,
} from '../lib/sources.ts';

const ROOT = join(import.meta.dirname, '..');

test('an unknown or missing source degrades to internal rather than throwing', () => {
  // A blank cell or a crash is a worse answer than "we computed this ourselves".
  assert.equal(sourceMeta(null).label, 'internal');
  assert.equal(sourceMeta(undefined).label, 'internal');
  assert.equal(sourceMeta('').label, 'internal');
  assert.equal(sourceMeta('a_provider_added_later').label, 'internal');
});

test('the three tones are distinguishable', () => {
  assert.equal(sourceMeta('meta_ads').tone, 'live');
  assert.equal(sourceMeta(DEMO_SOURCE).tone, 'seeded');
  assert.equal(sourceMeta(INTERNAL_SOURCE).tone, 'internal');
});

test('seeded data is never reported as live', () => {
  // The whole point of the badge: a seeded figure must never look reported.
  assert.equal(isLiveSource(DEMO_SOURCE), false);
  assert.equal(isSeeded(DEMO_SOURCE), true);
  assert.equal(isSeeded('meta_ads'), false);
  assert.equal(isLiveSource(null), false);
});

test('every registered provider has a source label', () => {
  // lib/sources.ts duplicates these ids because it must stay import-free for client
  // components. This is what stops the copy drifting from the registry: add a provider
  // and forget the label, and its figures would silently badge as "internal".
  const registry = readFileSync(join(ROOT, 'lib/integrations/registry.ts'), 'utf8');
  const imports = [...registry.matchAll(/from '\.\/providers\/([a-z0-9-]+)\.ts'/g)].map(
    (m) => m[1],
  );
  assert.ok(imports.length >= 4, `expected several providers, found ${imports.length}`);

  const missing: string[] = [];
  for (const file of imports) {
    const source = readFileSync(join(ROOT, 'lib/integrations/providers', `${file}.ts`), 'utf8');
    const id = /^\s*id: '([a-z0-9_]+)'/m.exec(source)?.[1];
    assert.ok(id, `could not read the provider id out of ${file}.ts`);
    if (!KNOWN_SOURCES.includes(id)) missing.push(id);
  }

  assert.deepEqual(missing, [], `providers with no entry in lib/sources.ts: ${missing.join(', ')}`);
});

test('lib/sources.ts imports nothing, so a client component can render a badge', () => {
  // Same contract as tools/client-boundary.test.ts: one import of a server module here
  // would drag Prisma into the browser bundle through every table that shows a badge.
  const source = readFileSync(join(ROOT, 'lib/sources.ts'), 'utf8');
  const imports = [...source.matchAll(/^\s*import\s/gm)];
  assert.equal(imports.length, 0, 'lib/sources.ts must stay import-free');
});
