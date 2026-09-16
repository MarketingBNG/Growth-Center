import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { libSource } from './source.ts';
import { join } from 'node:path';

// Guards the server/client boundary.
//
// This has bitten three times: a 'use client' component imported a constant from a
// module that also imports lib/platform/prisma, webpack followed the chain into the `pg` driver,
// and the build died on "Can't resolve 'fs'" — or worse, dev returned 500 on every
// route while the production build passed clean.
//
// Client-safe modules import nothing that reaches the database, so anything a client
// component needs belongs in lib/shared/enums.ts (values) or lib/shared/calc.ts
// (arithmetic). CLIENT_SAFE below is the list, and says why it is curated.

const ROOT = join(import.meta.dirname, '..');

/**
 * A relative specifier, resolved against the importing module's directory, as a path
 * relative to lib/.
 *
 * This used to strip a single leading `../` and then ignore the directory it was resolving
 * from, so anything reached by `../../` resolved to a name no module had and the taint was
 * dropped on the floor. lib/integrations/writers/crm.ts imports '../../prisma.ts' — as
 * direct a route to the database as exists here — and the scan called it clean. Nothing
 * failed: a scan that finds less reports fewer offenders, which is the vacuous pass the
 * last test in this file exists to catch.
 */
function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const out = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
  for (const part of spec.replace(/\.ts$/, '').split('/')) {
    if (part === '.') continue;
    else if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Every lib module that can reach the database, worked out by following imports.
 *
 * This used to be a hand-written list of sixteen names, and the list is what let the next
 * one through: `lib/crm/referrals.ts` was added, a client component imported a constant from
 * it, and the production build died on "Can't resolve fs" — after the type checker, the
 * linter and all 725 tests had passed clean. A list that has to be remembered is a list
 * that will be wrong the day it matters.
 *
 * Computed from the import graph instead. A module is tainted if it imports `pg` or
 * `./prisma`, or imports anything that is.
 */
function serverOnly(): Set<string> {
  const modules = new Map<string, string[]>();

  const scan = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scan(full, `${prefix}${entry}/`);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const name = `${prefix}${entry.replace(/\.ts$/, '')}`;
      const source = readFileSync(full, 'utf8');
      const imports: string[] = [];
      for (const line of source.match(/^\s*import\s[^;]+;/gm) ?? []) {
        // A type-only import is erased before the bundle exists, so it cannot taint.
        if (/^\s*import\s+type\s/.test(line)) continue;
        const from = line.match(/from\s+'([^']+)'/)?.[1];
        if (from) imports.push(from);
      }
      // `export … from` pulls the module in exactly as an import does, and a file that is
      // nothing but re-exports has no import line at all. lib/metrics.ts and
      // lib/content-calendar.ts are both that shape now: they front a directory whose
      // halves do reach Prisma. Reading only import lines, this scan called them
      // client-safe — the precise blindness it exists to prevent.
      for (const line of source.match(/^\s*export\s[^;]*\sfrom\s[^;]+;/gm) ?? []) {
        if (/^\s*export\s+type\s/.test(line)) continue;
        const from = line.match(/from\s+'([^']+)'/)?.[1];
        if (from) imports.push(from);
      }
      modules.set(name, imports);
    }
  };
  scan(join(ROOT, 'lib'), '');

  const tainted = new Set<string>();

  // Fixed point. Cheap at this size and immune to import order, which a single pass is
  // not — lib/a importing lib/b importing lib/platform/prisma would otherwise depend on which of
  // the two the directory listing reached first.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, imports] of modules) {
      if (tainted.has(name)) continue;
      const dirty = imports.some((spec) => {
        if (spec === 'pg' || spec.startsWith('@prisma/')) return true;
        const target = resolve(name, spec);
        return target !== null && (target === 'prisma' || tainted.has(target));
      });
      if (dirty) {
        tainted.add(name);
        changed = true;
      }
    }
  }

  return new Set([...tainted].map((m) => `lib/${m}`));
}

const SERVER_ONLY = [...serverOnly()].sort();

/**
 * The modules a client component may take a value from.
 *
 * Curated, not derived from the folder they happen to sit in. "Imports nothing" is not the
 * same question as "safe in a browser": lib/platform/cache.ts imports nothing statically
 * and reaches next/cache through an await import(), while lib/shared/utils.ts imports clsx
 * and is perfectly safe. A lib/shared/ that meant "client-safe" would be a claim the
 * directory cannot keep, so the mechanical half of this is serverOnly() above and the
 * judgment half is this list.
 *
 * Named by module rather than by path — libSource resolves them wherever they live — so
 * moving a file does not make this list wrong, only differently spelled.
 */
const CLIENT_SAFE = [
  'shared/enums',
  'shared/calc',
  'shared/utils',
  'shared/format',
  'shared/nav',
  'shared/fetcher',
  'shared/kpi',
  'shared/sources',
  // The currency arithmetic and the settings shape. The settings form renders it, and it
  // is deliberately import-free for that reason — lib/platform/settings.ts is the half
  // that touches the database.
  'shared/currency',
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
      // Anchored on the closing quote so @/lib/platform/api does not flag @/lib/apikeys.
      const pattern = new RegExp(`from ['"]${specifier}(\\.ts)?['"]`);
      if (pattern.test(source)) {
        offenders.push(`${file.slice(ROOT.length + 1)} imports ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `client components must take shared values from a module that imports nothing — ${CLIENT_SAFE.join(', ')} — rather than from one that can reach the database`,
  );
});

test('a client-safe module only reaches other client-safe modules', () => {
  // The list is what the other tests trust, so it has to keep being true. The invariant
  // is not "imports nothing" — lib/shared/kpi imports lib/shared/calc, and that is fine — it is that
  // nothing on the list can reach the database, directly or through a neighbour.
  //
  // A type-only import is exempt: it is erased before the bundle exists.
  const safe = new Set(CLIENT_SAFE);

  for (const mod of CLIENT_SAFE) {
    const source = libSource(mod);
    for (const line of source.match(/^\s*import\s[^;]+;/gm) ?? []) {
      const from = line.match(/from\s+'([^']+)'/)?.[1];
      // A package, not a module of ours.
      if (!from || !from.startsWith('.')) continue;
      if (/^\s*import\s+type\s/.test(line)) continue;

      // Resolved against the module's own directory, the same way serverOnly() does it.
      // These sit in lib/shared/ together, so a neighbour is './calc.ts' rather than a
      // bare name, and comparing the raw specifier would have passed on anything.
      const target = resolve(mod, from);
      assert.ok(
        target !== null && safe.has(target),
        `${mod} imports ${from}, which is not client-safe — a client component that renders it would pull ${target ?? from} into the browser bundle`,
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

// A scanner that silently returned nothing would make the test above vacuous: no
// server-only modules means no offenders, every time.
test('the import scan actually finds the modules that reach the database', () => {
  assert.ok(SERVER_ONLY.includes('lib/metrics'), 'lib/metrics reaches lib/platform/prisma');
  assert.ok(SERVER_ONLY.includes('lib/leads/leads'));
  // The one that got through when this list was hand-written.
  assert.ok(SERVER_ONLY.includes('lib/crm/referrals'));
  assert.ok(SERVER_ONLY.length > 20, `expected many, found ${SERVER_ONLY.length}`);

  // Reached by '../../prisma.ts', two directories up. resolve() used to strip one `../`
  // and ignore where it was resolving from, so every writer in this directory came back
  // clean — six modules that import the database more directly than almost anything else
  // in lib/. Asserted by depth rather than by name: what broke was nesting, so the guard
  // has to be a module that is nested.
  assert.ok(
    SERVER_ONLY.includes('lib/integrations/writers/crm'),
    'a module two directories deep still reaches lib/platform/prisma',
  );

  // …and that it is not simply flagging everything.
  for (const safe of CLIENT_SAFE) {
    assert.equal(
      SERVER_ONLY.includes(`lib/${safe}`),
      false,
      `${safe} is client-safe and must not be flagged`,
    );
  }
});
