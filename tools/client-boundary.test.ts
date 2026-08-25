import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Guards the server/client boundary.
//
// This has bitten three times: a 'use client' component imported a constant from a
// module that also imports lib/prisma, webpack followed the chain into the `pg` driver,
// and the build died on "Can't resolve 'fs'" — or worse, dev returned 500 on every
// route while the production build passed clean.
//
// Client-safe modules import nothing, so anything a client component needs belongs in
// lib/enums.ts (values) or lib/calc.ts (arithmetic).

const ROOT = join(import.meta.dirname, '..');

/** Modules that pull in the database driver, directly or transitively. */
const SERVER_ONLY = [
  'lib/prisma',
  'lib/metrics',
  'lib/campaigns',
  'lib/leads',
  'lib/crm',
  'lib/pipeline',
  'lib/apikeys',
  'lib/automation',
  'lib/crypto',
  'lib/auth',
  'lib/api',
  'lib/integrations/service',
  'lib/integrations/registry',
  'lib/oauth-state',
];

/** Modules with no imports at all, safe for either side. */
const CLIENT_SAFE = ['lib/enums', 'lib/calc', 'lib/utils', 'lib/format', 'lib/nav', 'lib/fetcher'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
const isClient = (source: string) => /^['"]use client['"]/.test(source.trimStart());

test('there are client components to check', () => {
  const count = files.filter((f) => isClient(readFileSync(f, 'utf8'))).length;
  assert.ok(count > 5, `expected several client components, found ${count}`);
});

test("no 'use client' file imports a server-only module", () => {
  const offenders: string[] = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    if (!isClient(raw)) continue;

    // `import type` is erased by the compiler and never reaches the bundle, so a
    // type-only import of a server module is safe. Blank those statements out, then
    // look for value imports in what remains.
    const source = raw.replace(/import\s+type\s+[^;]*;/g, '');

    for (const bad of SERVER_ONLY) {
      const specifier = `@/${bad}`;
      // Anchored on the closing quote so @/lib/api does not flag @/lib/apikeys.
      const pattern = new RegExp(`from ['"]${specifier}(\\.ts)?['"]`);
      if (pattern.test(source)) {
        offenders.push(`${file.slice(ROOT.length + 1)} imports ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `client components must take shared values from ${CLIENT_SAFE.join(', ')} instead`,
  );
});

test('the client-safe modules really do have no imports', () => {
  for (const mod of ['lib/enums', 'lib/calc']) {
    const source = readFileSync(join(ROOT, `${mod}.ts`), 'utf8');
    const imports = source.match(/^\s*import\s/gm) ?? [];
    assert.equal(imports.length, 0, `${mod}.ts must import nothing, found ${imports.length}`);
  }
});
