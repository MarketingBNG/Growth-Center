import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Which cache tags a write drops.
//
// The bug this exists for: the currency route invalidated TAGS.settings and not
// TAGS.metrics. Dropping `settings` only makes the next read fetch the new rates — it
// does nothing about the six reads cached under `metrics` that had already converted with
// the OLD rates and stored the result. So changing the reporting currency left the
// dashboard showing figures derived from the previous base for the rest of the five
// minute TTL, on the very screen where the user had just declared those numbers wrong.
//
// Nothing failed. The route returned 200, the settings page showed the new currency, and
// the figures underneath it were stale in a way no error could describe.

const ROOT = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const routes = walk(join(ROOT, 'app', 'api')).map((file) => ({
  // Split on the platform separator rather than matching one: these run on Windows,
  // where the walked paths come back with backslashes and every assertion below is
  // written in posix.
  path: file.slice(ROOT.length + 1).split(sep).join('/'),
  source: readFileSync(file, 'utf8'),
}));

/**
 * A route file split into its handlers.
 *
 * Per handler, not per file, and that distinction is the whole test. The currency route
 * has a PUT and a POST; when only the PUT was missing TAGS.metrics, a check that pooled
 * every invalidate() call in the file saw the POST's tag and passed. The first version of
 * this test did exactly that and reported the bug as fixed while it was still there.
 */
function handlers(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/export const (GET|PUT|POST|PATCH|DELETE) =/g)];
  return starts.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : source.length),
  }));
}

test('the handler split finds both of the currency route handlers', () => {
  // Guards the splitter itself: if this returned one handler, or none, every assertion
  // below would pass vacuously — which is the failure mode this file was written about.
  const route = routes.find((r) => r.path === 'app/api/settings/currency/route.ts')!;
  const names = handlers(route.source)
    .map((h) => h.name)
    .sort();
  assert.deepEqual(names, ['GET', 'POST', 'PUT']);
});

test('there are settings routes to check', () => {
  const settings = routes.filter((r) => r.path.includes('app/api/settings/'));
  assert.ok(settings.length >= 6, `expected the settings routes, found ${settings.length}`);
});

/**
 * Settings whose value feeds a figure cached under TAGS.metrics.
 *
 * Deliberately a list rather than something derived: the question "does this setting
 * change a number on a chart" is a judgement about what the setting MEANS, and a scanner
 * that tried to answer it from imports would have to follow currencySettings() through
 * six cached readers to get there. Glossary is the one settings route correctly absent —
 * it reassigns who owns a definition, which only the glossary page reads.
 */
const FEEDS_METRICS = ['capacity', 'currency', 'owners', 'roster', 'thresholds'];

for (const name of FEEDS_METRICS) {
  test(`app/api/settings/${name} drops the metrics cache, not just settings`, () => {
    const route = routes.find((r) => r.path === `app/api/settings/${name}/route.ts`);
    assert.ok(route, `no route at app/api/settings/${name}`);

    // Every handler that writes. Checked one at a time: a sibling handler getting it
    // right must not cover for one getting it wrong.
    const writers = handlers(route.source).filter((h) => h.body.includes('invalidate('));
    assert.ok(writers.length > 0, `${name} invalidates nothing at all`);

    for (const h of writers) {
      // Both spellings are in use and both are fine: one call taking two tags, or two
      // calls taking one each. What is not fine is dropping `settings` alone.
      const tags = (h.body.match(/invalidate\([^)]*\)/g) ?? []).join(' ');
      assert.match(tags, /TAGS\.settings/, `${name} ${h.name} never drops the settings cache`);
      assert.match(
        tags,
        /TAGS\.metrics/,
        `${name} ${h.name} changes a figure but leaves the metrics cache holding the old one`,
      );
    }
  });
}

test('the glossary route is deliberately settings-only', () => {
  // Asserted rather than left unsaid, so that adding TAGS.metrics here is a decision
  // somebody makes on purpose instead of a tidy-up that makes the five above look
  // consistent. Nothing cached under `metrics` reads a glossary owner.
  const route = routes.find((r) => r.path === 'app/api/settings/glossary/route.ts')!;
  const tags = (route.source.match(/invalidate\([^)]*\)/g) ?? []).join(' ');
  assert.match(tags, /TAGS\.settings/);
  assert.doesNotMatch(tags, /TAGS\.metrics/);
});

test('every write that invalidates anything names a real tag', () => {
  // A typo'd tag is a no-op that looks exactly like a working call.
  const known = ['integrations', 'settings', 'seo', 'social', 'metrics'];
  for (const route of routes) {
    for (const call of route.source.match(/invalidate\([^)]*\)/g) ?? []) {
      for (const tag of call.match(/TAGS\.(\w+)/g) ?? []) {
        const name = tag.slice('TAGS.'.length);
        assert.ok(known.includes(name), `${route.path} invalidates unknown tag ${tag}`);
      }
    }
  }
});
