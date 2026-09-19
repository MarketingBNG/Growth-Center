import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_KEY_PATTERN,
  checkFacts,
  parsePlaceholders,
  renderFacts,
  scanUnverifiedTokens,
  type FactLike,
} from '../lib/content/facts.ts';

// The facts gate — the engine's first non-negotiable, which is that the model never
// originates a tax number.
//
// This is the rule everything else defers to, so the tests are written as the rule rather
// than as coverage of the functions.

const fact = (key: string, value: string, status = 'approved'): FactLike => ({ key, value, status });

const FACTS: FactLike[] = [
  fact('US-FBAR-THRESHOLD', '$10,000'),
  fact('US-CORP-TAX-RATE', '21%'),
  fact('IN-ITR-DEADLINE', '31 July'),
  fact('US-5471-FORM', 'Form 5471'),
  fact('US-DRAFT-RATE', '18%', 'draft'),
  fact('US-PROPOSED-CAP', '$50,000', 'proposed'),
];

// ── placeholders ─────────────────────────────────────────────────────────────────────

test('placeholders are found, spaces and all', () => {
  const found = parsePlaceholders('A {{fact:US-FBAR-THRESHOLD}} and {{ fact: US-CORP-TAX-RATE }}');
  assert.deepEqual(found.map((p) => p.key), ['US-FBAR-THRESHOLD', 'US-CORP-TAX-RATE']);
});

test('an approved fact is substituted', () => {
  const { text, used } = renderFacts('Report over {{fact:US-FBAR-THRESHOLD}}.', FACTS);
  assert.equal(text, 'Report over $10,000.');
  assert.deepEqual(used, ['US-FBAR-THRESHOLD']);
});

// A blanked placeholder reads like an editing slip — "the threshold is " — and has a
// decent chance of being published. Left as written, it is obviously unfinished.
test('an unknown fact is left in the prose, never blanked', () => {
  const { text, missing } = renderFacts('Over {{fact:NO-SUCH-KEY}}.', FACTS);
  assert.equal(text, 'Over {{fact:NO-SUCH-KEY}}.');
  assert.deepEqual(missing, ['NO-SUCH-KEY']);
});

test('a fact that exists but is not cleared is refused, and says which state it is in', () => {
  const { text, unapproved } = renderFacts('Rate is {{fact:US-DRAFT-RATE}}.', FACTS);
  assert.equal(text, 'Rate is {{fact:US-DRAFT-RATE}}.', 'an uncleared value must not reach the prose');
  assert.deepEqual(unapproved, [{ key: 'US-DRAFT-RATE', status: 'draft' }]);
});

test('proposed is not approved either', () => {
  const { unapproved } = renderFacts('{{fact:US-PROPOSED-CAP}}', FACTS);
  assert.equal(unapproved[0].status, 'proposed');
});

test('a key is repeated in the text but reported once', () => {
  const { missing } = renderFacts('{{fact:NOPE}} and {{fact:NOPE}}', FACTS);
  assert.deepEqual(missing, ['NOPE']);
});

test('the key format is what an author can type', () => {
  assert.ok(FACT_KEY_PATTERN.test('US-FBAR-THRESHOLD'));
  assert.ok(FACT_KEY_PATTERN.test('IN-80C-LIMIT'));
  assert.ok(!FACT_KEY_PATTERN.test('us-fbar'), 'lower case');
  assert.ok(!FACT_KEY_PATTERN.test('US--FBAR'), 'empty segment');
  assert.ok(!FACT_KEY_PATTERN.test('-US-FBAR'), 'leading dash');
  assert.ok(!FACT_KEY_PATTERN.test('1-FBAR'), 'must start with a letter');
});

// ── the scanner ──────────────────────────────────────────────────────────────────────

test('a figure typed straight into the prose is caught', () => {
  const found = scanUnverifiedTokens('You must report balances over $10,000.', FACTS);
  assert.equal(found.length, 1);
  assert.equal(found[0].token, '$10,000');
  assert.equal(found[0].kind, 'money');
});

// The trap this whole design turns on. Once the placeholder renders to "$10,000", a naive
// scanner flags the register's OWN approved value as a violation — the gate reporting
// itself.
test("the register's own value is not reported as a violation", () => {
  const found = scanUnverifiedTokens('Balances over {{fact:US-FBAR-THRESHOLD}} are reportable.', FACTS);
  assert.deepEqual(found, [], 'the approved substitution must not trip the scanner');
});

test('a declared figure and an undeclared one in the same sentence are told apart', () => {
  const found = scanUnverifiedTokens(
    'Over {{fact:US-FBAR-THRESHOLD}} you file, and the penalty is $50,000.',
    FACTS,
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].token, '$50,000');
});

// An unresolved placeholder is still literally in the text; it must not accidentally
// shield a real figure sitting next to it.
test('an unresolved placeholder does not shield the figures around it', () => {
  const found = scanUnverifiedTokens('{{fact:NOPE}} and also $99.', FACTS);
  assert.equal(found.length, 1);
  assert.equal(found[0].token, '$99');
});

test('rates, forms and filing dates are each caught', () => {
  assert.equal(scanUnverifiedTokens('taxed at 21%', []).length, 1);
  assert.equal(scanUnverifiedTokens('taxed at 37.5 per cent', []).length, 1);
  assert.equal(scanUnverifiedTokens('file Form 5471', []).length, 1);
  assert.equal(scanUnverifiedTokens('attach Schedule K-1', []).length, 1);
  assert.equal(scanUnverifiedTokens('submit a W-8BEN', []).length, 1);
  assert.equal(scanUnverifiedTokens('the FBAR is due', []).length, 1);
  assert.equal(scanUnverifiedTokens('due by 15 April', []).length, 1);
  assert.equal(scanUnverifiedTokens('due by April 15', []).length, 1);
});

test('rupee amounts and Indian number words are caught too', () => {
  assert.equal(scanUnverifiedTokens('₹5,00,000 must be declared', []).length, 1);
  assert.equal(scanUnverifiedTokens('over 50 lakh', []).length, 1);
  assert.equal(scanUnverifiedTokens('1.2 crore', []).length, 1);
});

// The deliberate limits. A gate that blocks "three things to know" is a gate somebody
// turns off, and then it protects nothing.
test('ordinary prose numbers are left alone', () => {
  assert.deepEqual(scanUnverifiedTokens('Three things to know in 2026.', []), []);
  assert.deepEqual(scanUnverifiedTokens('The second test has 5 steps.', []), []);
  assert.deepEqual(scanUnverifiedTokens('Founded in 1998 with 12 staff.', []), []);
});

// Stated as a test rather than only as a comment, so the hole is visible to whoever reads
// this next and is never mistaken for an oversight.
test('a bare number that IS a threshold gets through, and that is known', () => {
  assert.deepEqual(
    scanUnverifiedTokens('the limit is 10000', []),
    [],
    'nothing here can tell this from a word count — the reviewer is the mitigation, not the regex',
  );
});

test('findings come back in the order they appear in the draft', () => {
  const found = scanUnverifiedTokens('First $1, then 5%, then Form 1120.', []);
  assert.deepEqual(found.map((f) => f.kind), ['money', 'percentage', 'form']);
});

// ── the gate ─────────────────────────────────────────────────────────────────────────

test('a clean draft passes and says so', () => {
  const result = checkFacts(
    'Report balances over {{fact:US-FBAR-THRESHOLD}} using {{fact:US-5471-FORM}}.',
    FACTS,
  );
  assert.equal(result.ok, true);
  assert.equal(result.rendered, 'Report balances over $10,000 using Form 5471.');
  assert.deepEqual(result.used, ['US-FBAR-THRESHOLD', 'US-5471-FORM']);
  assert.match(result.summary, /resolves to an approved fact/);
});

test('a draft with a typed figure is blocked, and the message names it', () => {
  const result = checkFacts('The threshold is $10,000.', FACTS);
  assert.equal(result.ok, false);
  assert.match(result.summary, /\$10,000/);
});

test('an uncleared fact blocks the draft even though the placeholder is valid', () => {
  const result = checkFacts('The rate is {{fact:US-DRAFT-RATE}}.', FACTS);
  assert.equal(result.ok, false);
  assert.match(result.summary, /not cleared by a reviewer/);
  assert.match(result.summary, /US-DRAFT-RATE/);
});

test('every reason a draft is blocked is reported at once, not one per attempt', () => {
  const result = checkFacts('{{fact:NOPE}}, {{fact:US-DRAFT-RATE}}, and $500.', FACTS);
  assert.equal(result.ok, false);
  assert.match(result.summary, /unknown fact/);
  assert.match(result.summary, /not cleared/);
  assert.match(result.summary, /no approved fact behind/);
});

test('a draft with no figures at all is fine', () => {
  const result = checkFacts('Here is how we think about cross-border structuring.', FACTS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.used, []);
});

test('an empty draft does not throw', () => {
  assert.equal(checkFacts('', FACTS).ok, true);
});

// ── the gate is wired in, not merely importable ──────────────────────────────────────
//
// A rule nothing calls is a library. These read the source rather than the behaviour,
// because approveContent needs a database and this suite deliberately has none — the same
// approach tools/permission-idiom.test.ts takes to the same problem.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const contentSource = readFileSync(
  join(import.meta.dirname, '..', 'lib', 'content', 'content.ts'),
  'utf8',
);

test('approving a content piece runs the facts gate', () => {
  assert.match(contentSource, /checkFacts\(/, 'approveContent no longer calls the gate');
  assert.match(
    contentSource,
    /throw new ApprovalError\(\s*`This piece cannot be approved until its figures/,
    'the gate is called but its result is not acted on',
  );
});

test('the approval records which facts it rested on', () => {
  // "Approved on the 19th" means little without the version of the numbers that were
  // true that day, and a fact can be superseded afterwards.
  assert.match(contentSource, /facts: gate\.used/);
});

// The known limit, asserted so it is visible rather than discovered. When WP10's draft
// body arrives, factsText is the one place that has to change.
test('the text the gate reads is named in one place', () => {
  assert.match(contentSource, /const factsText = /);
  assert.match(contentSource, /checkFacts\(factsText\(piece\)/);
});
