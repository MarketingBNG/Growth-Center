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
  'lib/band',
  'lib/campaigns',
  'lib/leads',
  'lib/crm',
  'lib/pipeline',
  'lib/apikeys',
  'lib/automation',
  'lib/crypto',
  'lib/auth',
  'lib/users',
  'lib/api',
  'lib/integrations/service',
  'lib/integrations/registry',
  'lib/oauth-state',
];

/** Modules with no imports at all, safe for either side. */
const CLIENT_SAFE = [
  'lib/enums',
  'lib/calc',
  'lib/utils',
  'lib/format',
  'lib/nav',
  'lib/fetcher',
  'lib/kpi',
  'lib/sources',
  // The currency arithmetic and the settings shape. The settings form renders it, and it
  // is deliberately import-free for that reason — lib/settings.ts is the half that
  // touches the database.
  'lib/currency',
];

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

test('a client-safe module only reaches other client-safe modules', () => {
  // The list is what the other tests trust, so it has to keep being true. The invariant
  // is not "imports nothing" — lib/kpi imports lib/calc, and that is fine — it is that
  // nothing on the list can reach the database, directly or through a neighbour.
  //
  // A type-only import is exempt: it is erased before the bundle exists.
  const safe = new Set(CLIENT_SAFE.map((m) => m.replace('lib/', '')));

  for (const mod of CLIENT_SAFE) {
    const source = readFileSync(join(ROOT, `${mod}.ts`), 'utf8');
    for (const line of source.match(/^\s*import\s[^;]+;/gm) ?? []) {
      const from = line.match(/from\s+'([^']+)'/)?.[1];
      // A package, not a module of ours.
      if (!from || !from.startsWith('.')) continue;
      if (/^\s*import\s+type\s/.test(line)) continue;

      const target = from.replace(/^\.\//, '').replace(/\.ts$/, '');
      assert.ok(
        safe.has(target),
        `${mod}.ts imports ./${target}, which is not client-safe — a client component that renders it would pull ${target} into the browser bundle`,
      );
    }
  }
});

test('no client component reaches a server-only module through another component', () => {
  // The direct check above misses the chain that actually shipped: MetricsBand is a
  // client component, it renders KpiCard, and KpiCard imported kpiDelta from
  // lib/metrics as a VALUE. KpiCard carries no 'use client' of its own, so nothing
  // flagged it — but once a client component imports it, everything it imports lands
  // in the browser graph too, driver and all.
  const read = (f: string) => readFileSync(f, 'utf8');
  const byPath = new Map(files.map((f) => [f, read(f)]));

  /** Resolves a relative or @/-prefixed specifier to a file we walked. */
  function resolve(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith('.')) base = join(fromFile, '..', spec);
    else return null;
    base = base.replace(/\.tsx?$/, '');
    for (const ext of ['.tsx', '.ts']) {
      if (byPath.has(base + ext)) return base + ext;
    }
    return null;
  }

  function valueImports(source: string): string[] {
    const stripped = source.replace(/import\s+type\s+[^;]*;/g, '');
    return [...stripped.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  const offenders: string[] = [];

  for (const entry of files) {
    if (!isClient(byPath.get(entry)!)) continue;

    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift()!;
      const source = byPath.get(file)!;

      for (const spec of valueImports(source)) {
        for (const bad of SERVER_ONLY) {
          if (spec === `@/${bad}` || spec === `@/${bad}.ts`) {
            offenders.push(
              `${entry.slice(ROOT.length + 1)} -> ${file.slice(ROOT.length + 1)} imports @/${bad}`,
            );
          }
        }
        const next = resolve(file, spec);
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `a client component reaches the database through a component it renders; move the shared value into ${CLIENT_SAFE.join(', ')}`,
  );
});
