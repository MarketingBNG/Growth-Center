import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GLOSSARY,
  GLOSSARY_SLUGS,
  disagreementCount,
  isGlossarySlug,
  ownerKey,
  parseOwner,
} from '../lib/glossary.ts';

// Appendix C names thirteen terms. A glossary that quietly drops one is worse than no
// glossary: the word stays in use and now has no entry to look up.
test('every term the manual names has an entry', () => {
  const expected = [
    'Lead',
    'Qualified lead',
    'Semi-qualified',
    'Opportunity',
    'Customer',
    'New business',
    'CPQL',
    'Attribution health',
    'Quality score',
    'Speed to lead',
    'Insight',
    'Action item',
    'Review card',
  ];
  assert.deepEqual(
    GLOSSARY.map((t) => t.term),
    expected,
  );
});

test('slugs are unique', () => {
  assert.equal(new Set(GLOSSARY_SLUGS).size, GLOSSARY.length);
});

// The point of the page. If a difference is ever resolved by changing the code, this
// number moves and the headline moves with it — it is never written by hand.
test('the disagreement count is derived, not asserted', () => {
  assert.equal(disagreementCount(), GLOSSARY.filter((t) => t.agreement !== 'agrees').length);
});

// A "differs" or "not-computed" entry with no explanation is the failure this page exists
// to prevent: the reader sees a badge, learns nothing, and goes back to guessing.
test('every difference from the manual carries a reason', () => {
  for (const term of GLOSSARY) {
    if (term.agreement === 'agrees') continue;
    assert.ok(term.note && term.note.length > 40, `${term.term} has no note`);
  }
});

// Every entry quotes the manual, including the ones that agree — the page only renders
// the quote where it differs, but the comparison has to be recorded to be checkable.
test('every entry records the manual wording and an owner', () => {
  for (const term of GLOSSARY) {
    assert.ok(term.manual.trim(), `${term.term} has no manual wording`);
    assert.ok(term.defaultOwner.trim(), `${term.term} has no owner`);
    assert.ok(term.definition.trim().length > 20, `${term.term} has no definition`);
  }
});

// An entry that claims the code implements something must say where, or the claim is
// unfalsifiable. An entry that says nothing computes it has nowhere to point.
test('a computed term says where, and an uncomputed one may not', () => {
  for (const term of GLOSSARY) {
    if (term.agreement === 'not-computed') continue;
    assert.ok(term.where, `${term.term} claims a definition with no location`);
  }
});

test('slug recognition refuses anything not in the list', () => {
  assert.ok(isGlossarySlug('cpql'));
  assert.ok(!isGlossarySlug('cpql '));
  assert.ok(!isGlossarySlug('glossary.owner.cpql'));
  assert.ok(!isGlossarySlug(''));
  assert.ok(!isGlossarySlug(undefined));
  assert.ok(!isGlossarySlug(42));
});

test('the setting key is namespaced', () => {
  assert.equal(ownerKey('cpql'), 'glossary.owner.cpql');
});

// ── Owner parsing ─────────────────────────────────────────────────────────────────────
//
// Null means "no override", and it has to have exactly one representation: a stored empty
// string would render as a blank owner rather than as the default, and the column would
// look answered when nobody had answered it.

test('an empty or blank owner clears the override', () => {
  assert.equal(parseOwner(''), null);
  assert.equal(parseOwner('   '), null);
  assert.equal(parseOwner(null), null);
  assert.equal(parseOwner(undefined), null);
  assert.equal(parseOwner({}), null);
  assert.equal(parseOwner({ owner: '  ' }), null);
});

test('an owner is trimmed', () => {
  assert.equal(parseOwner('  Akshay  '), 'Akshay');
  assert.equal(parseOwner({ owner: ' Sales ' }), 'Sales');
});

// Both shapes, because the value arrives from the route as a bare string and comes back
// out of AppSetting.value as { owner }, the way every other key in that table is stored.
test('both the stored and the submitted shape read the same', () => {
  assert.equal(parseOwner('Metrics layer'), parseOwner({ owner: 'Metrics layer' }));
});

test('an owner is capped rather than refused', () => {
  assert.equal(parseOwner('x'.repeat(200))?.length, 80);
});

// Non-string junk must not become the string "42" or "[object Object]", which would show
// up in the owner column as though somebody had typed it.
test('junk is not coerced into an owner', () => {
  assert.equal(parseOwner(42), null);
  assert.equal(parseOwner({ owner: 42 }), null);
  assert.equal(parseOwner([1, 2]), null);
});
