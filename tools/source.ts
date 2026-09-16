// Finding a source file to assert about, without writing its path down.
//
// Twenty-five tests in this directory read a module as text and assert on what is in it —
// that a rule still reads the threshold it claims to, that a page still hides owner names.
// Every one of them located its target with a literal like readFileSync('lib/ai/ai.ts'),
// which the type checker cannot see and which stops being true the moment a file moves.
//
// The failure that matters is not the loud one. A missing file throws, and somebody fixes
// it. A locator that quietly returned nothing would leave `assert.match(source, /x/)`
// testing an empty string — reported as a pass, on a file that no longer exists. So
// everything here throws rather than returning empty, and says what it looked for.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');

const SKIP = new Set(['node_modules', '.next', '.git', 'generated', 'test-results', 'screenshots']);

/**
 * Every file under `dir`, recursively.
 *
 * Five tests had their own copy of this under four different names, each with its own idea
 * of what to skip — one of them skipped nothing at all, so it would have walked into
 * node_modules the day one appeared below app/. `ext` is matched against the end of the
 * filename, so '.ts' also accepts '.tsx' only if you ask for both.
 */
export function walk(dir: string, exts: readonly string[] = ['.ts', '.tsx'], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** A repo-relative path with forward slashes, whatever the platform uses. */
export const relative = (file: string): string => file.slice(ROOT.length + 1).split(sep).join('/');

type Index = { byPath: Map<string, string>; byBase: Map<string, string[]> };
let index: Index | null = null;

/**
 * Every module under lib/, indexed twice: by its path relative to lib/, and by basename.
 *
 * Kept apart rather than in one map, because they collide. `lib/leads/leads.ts` and
 * `lib/reports/leads.ts` both have the basename "leads", but "leads" is also the exact
 * path of the first — so a single map would call an unambiguous name ambiguous.
 */
function libIndex(): Index {
  if (index) return index;
  const byPath = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const file of walk(join(ROOT, 'lib'), ['.ts'])) {
    const path = relative(file).replace(/^lib\//, '').replace(/\.ts$/, '');
    const base = path.slice(path.lastIndexOf('/') + 1);
    byPath.set(path, file);
    byBase.set(base, [...(byBase.get(base) ?? []), file]);
  }
  index = { byPath, byBase };
  return index;
}

const cache = new Map<string, string>();

function read(file: string): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8');
    cache.set(file, text);
  }
  return text;
}

/**
 * A lib module's source, by name.
 *
 * `libSource('insight-rules')` and `libSource('metrics/core')` both work: the basename is
 * enough until two modules share one, and then it insists on the path rather than picking.
 * Where a test reads the same file twice — attribution.test.ts reads two of them twice
 * over — the second read is served from memory.
 */
export function libSource(name: string): string {
  const key = name.replace(/^lib\//, '').replace(/\.ts$/, '');
  const { byPath, byBase } = libIndex();

  // An exact path wins outright — it already says which module it means, even when some
  // other directory happens to hold a file of the same name.
  const exact = byPath.get(key);
  if (exact) return read(exact);

  const found = byBase.get(key);

  if (!found) {
    throw new Error(
      `No lib module named "${name}". Nothing under lib/ matches, so an assertion about it ` +
        `would be an assertion about nothing. Check the name, or pass a path relative to ` +
        `lib/ such as "metrics/core".`,
    );
  }
  if (found.length > 1) {
    throw new Error(
      `"${name}" matches ${found.length} modules: ${found.map(relative).join(', ')}. ` +
        `Pass the path relative to lib/ to say which one.`,
    );
  }
  return read(found[0]);
}

/**
 * Any other file in the repo, by its path from the root.
 *
 * For the targets that are not lib modules — app/(app)/page.tsx, prisma/schema.prisma,
 * vercel.json. Those are not moving, so naming them is fine; what this adds over
 * readFileSync is the cache and a failure that says which test wanted the file.
 */
export function source(path: string): string {
  try {
    return read(join(ROOT, path));
  } catch {
    throw new Error(`No file at "${path}" (looked in ${ROOT}).`);
  }
}
