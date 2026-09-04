// §20.7's eval set, as a release gate.
//
//   npm run eval          every probe, including the two that call the model
//   npm run eval -- --free   the deterministic probes only, no spend
//
// Separate from `npm test` on purpose, and the reason is money rather than tidiness. Two
// of the six probe families need a real model call, so the full set costs a fraction of a
// rupee per run — trivial once before a release, wrong to charge for on every save. The
// deterministic checks underneath live in lib/eval-checks.ts and are unit-tested in
// `npm test` like anything else, so the checkers themselves are covered for free and the
// paid run exercises the model against them.
//
// ── The release rules are §20.7's, not mine ───────────────────────────────────────────
//
// Fabrication and arithmetic block on a single miss. Everything else must pass, which is
// the same thing said less emphatically, so the distinction shows up here only in what the
// summary says — a blocked release names the probe that blocked it.
//
// What is honestly absent, said here rather than buried:
//
//   Golden insights are the rules' own findings on live data, not a fixed set of 20–30
//   cases. A golden set needs input fixtures held still, and every rule here queries the
//   production database; freezing them means a fixture layer that does not exist. What
//   this checks instead is the invariant the golden set exists to protect — that no figure
//   in the narration is absent from the evidence — against whatever fired today.
//
//   Fabrication probes check that an unverified figure is flagged, not that a wrong one is.
//   "Wrong" needs the controlled corpus §20.7 assumes, and there is no corpus. The linter
//   checks shape: a penalty figure with no verification recorded against it is caught
//   whether it is right or wrong, which is the half that can be done without one.
//
//   The regression family carries this session's failures that a unit test cannot hold —
//   the ones about how the model behaves rather than what a function returns.

import process from 'node:process';

import {
  arithmeticVerdict,
  figuresIn,
  percentageWithoutBasis,
  unsupportedFigures,
} from '../lib/eval-checks.ts';
import { blocksSending, lintStep, type LintableStep } from '../lib/outreach-lint.ts';
import { requirementFor, type InsightStatus } from '../lib/insight-lifecycle.ts';
import { fingerprint, normaliseSubject } from '../lib/insight-identity.ts';
import { RULES, runRules } from '../lib/insight-rules.ts';
import { aiStatus, ask, generateInsights, growthContext } from '../lib/ai.ts';
import { db } from '../lib/prisma.ts';

const FREE_ONLY = process.argv.includes('--free');

// Read once, at startup, so the regression probe is checking the file that shipped.
const THRESHOLD_SOURCE = await (await import('node:fs/promises')).readFile(
  new URL('../lib/settings.ts', import.meta.url),
  'utf8',
);

type Result = {
  family: string;
  probe: string;
  pass: boolean;
  /** Set when §20.7 says a single miss blocks release. */
  blocking: boolean;
  detail: string;
};

const results: Result[] = [];

function record(family: string, probe: string, pass: boolean, blocking: boolean, detail: string) {
  results.push({ family, probe, pass, blocking, detail });
  const mark = pass ? '  ok  ' : blocking ? ' BLOCK' : ' FAIL ';
  console.log(`${mark} ${family} · ${probe}${detail ? ` — ${detail}` : ''}`);
}

// ── Family 1: schema edge cases ───────────────────────────────────────────────────────
//
// §20.7: "Long text, missing owner, unknown section. Must validate or fail loudly."
// Loudly is the operative word — the failure these guard against is a finding that stores
// successfully with a field quietly empty, and is then worked from.

function schemaEdgeCases() {
  const family = 'schema';

  // Assigning with no owner. The one the manual names, and the orphan it names it for.
  const noOwner = requirementFor('assigned', { ownerEmail: null, reviewNote: null });
  record(family, 'assigning without an owner is refused', noOwner !== null, false, noOwner ?? 'accepted');

  const noNote = requirementFor('dismissed', { ownerEmail: null, reviewNote: '   ' });
  record(family, 'dismissing on whitespace is refused', noNote !== null, false, noNote ?? 'accepted');

  // A status the machine does not have. Reaching this by a typo in a payload must not
  // silently land the finding somewhere plausible.
  const unknown = requirementFor('archived' as InsightStatus, { ownerEmail: null, reviewNote: 'x' });
  record(
    family,
    'an unknown status has no requirement to satisfy',
    unknown === null,
    false,
    'the transition table is what refuses it, not the requirement check',
  );

  // Long text. A subject long enough to be a paragraph must still produce a usable, stable
  // fingerprint rather than one key per rewording.
  const long = `${'Cost per lead has risen sharply across every paid channel '.repeat(20)}`;
  const slug = normaliseSubject(long);
  const stable = fingerprint('risk', long) === fingerprint('risk', `  ${long.toUpperCase()}  `);
  record(
    family,
    'a paragraph-length subject still fingerprints',
    slug !== null && slug.length > 0 && slug.length <= 120 && stable,
    false,
    `${slug?.length ?? 0} chars, stable across case and padding: ${stable}`,
  );

  // An empty subject must yield no fingerprint at all. Null is the right answer and an
  // empty string is not: a shared empty slug would hash to one key every finding collides
  // on, which is worse than having no identity.
  const empty = normaliseSubject('   ');
  record(
    family,
    'an empty subject does not become a shared key',
    empty === null && fingerprint('risk', '   ') === null,
    false,
    `got ${JSON.stringify(empty)}`,
  );

  // Every rule must declare the fields a finding is stored with. A rule missing its
  // section stores a finding the executive pack cannot place.
  const incomplete = RULES.filter((r) => !r.id || !r.section || !r.severity || !r.test);
  record(
    family,
    'every rule declares id, section, severity and test',
    incomplete.length === 0,
    false,
    incomplete.length ? incomplete.map((r) => r.id || '(no id)').join(', ') : `${RULES.length} rules`,
  );

  // Rule ids are the identity findings are reconciled by. Two rules sharing one would
  // silently merge their findings.
  const ids = RULES.map((r) => r.id);
  record(family, 'rule ids are unique', new Set(ids).size === ids.length, false, `${ids.length} rules`);
}

// ── Family 2: fabrication probes ──────────────────────────────────────────────────────
//
// §20.7: "An asset carrying a plausible but wrong penalty figure. Must be flagged. A
// single miss blocks release."
//
// Plausible is the point of these. Every figure below is one a CFO-services firm might
// really write, in the register it would really be written in — which is what makes an
// unflagged one dangerous rather than obviously broken.

const FABRICATION_PROBES: { name: string; step: LintableStep }[] = [
  {
    name: 'a penalty figure stated as fact',
    step: {
      position: 1,
      subject: 'Your GST filing deadline',
      body: 'Late filing carries a penalty of ₹200 per day, capped at 0.25% of turnover. We can take this off your desk.',
    },
  },
  {
    name: 'a percentage rate in the body',
    step: {
      position: 1,
      subject: 'TDS on professional fees',
      body: 'The rate is 10% and the threshold is ₹30,000 a year — most firms we speak to are deducting at the wrong one.',
    },
  },
  {
    name: 'a saving claimed as a figure',
    step: {
      position: 1,
      subject: 'What we saved a client like you',
      body: 'We reduced one client’s compliance cost by ₹4,20,000 in the first year.',
    },
  },
  {
    name: 'a plausible but wrong statutory cap',
    step: {
      position: 1,
      subject: 'Audit thresholds',
      body: 'The tax audit threshold is ₹5 crore for businesses filing digitally.',
    },
  },
  {
    name: 'scaffolding shipped as a field',
    step: { position: 1, subject: '{{Subject}}', body: 'Hello {{First Name}}, {{Body}}' },
  },
  {
    name: 'a bracketed placeholder left in',
    step: { position: 1, subject: 'Quick question', body: 'Hi — we work with [industry] firms in [city].' },
  },
];

function fabricationProbes() {
  const family = 'fabrication';
  for (const probe of FABRICATION_PROBES) {
    const findings = lintStep(probe.step, true);
    // A finding of any kind is not enough: the figure itself has to be what was caught.
    // A probe that passed only because the subject was also broken would pass for the
    // wrong reason and stop testing anything.
    const figures = figuresIn(probe.step.body).length > 0;
    const caught = figures
      ? findings.some((f) => f.code === 'unverified-figure')
      : findings.length > 0;
    record(
      family,
      probe.name,
      caught,
      true,
      caught
        ? findings.map((f) => f.code).join(', ')
        : `nothing flagged the figure; got ${findings.map((f) => f.code).join(', ') || 'no findings'}`,
    );
  }

  // A clean template must not be flagged. Without this the family passes by flagging
  // everything, which is the cheapest way to make a probe suite meaningless.
  const clean: LintableStep = {
    position: 1,
    subject: 'A question about your month-end close',
    body: 'Hi {{first_name}}, I work with finance teams at {{company_name}}. Would a short call be useful?',
  };
  const cleanFindings = lintStep(clean, true);
  record(
    family,
    'a clean template is not flagged',
    cleanFindings.length === 0,
    true,
    cleanFindings.map((f) => `${f.code}: ${f.excerpt}`).join('; ') || 'clean',
  );

  // And the gate the linter feeds has to actually close.
  const blocked = blocksSending(lintStep(FABRICATION_PROBES[4].step, true));
  record(family, 'scaffolding blocks sending', blocked, true, blocked ? 'blocked' : 'would send');
}

// ── Family 3: adversarial data ────────────────────────────────────────────────────────
//
// §20.7: "Contradictory or missing rows. Must degrade to a deferral, not a guess." For a
// rule, silence is the deferral: a rule that fires on nothing produces evidence full of
// zeros, and a zero on the executive pack reads as a measurement somebody took.

async function adversarialData() {
  const family = 'adversarial';

  // A window in which this business did not exist. Every rule sees real tables and no
  // rows, which is the closest thing to "missing rows" that does not require a fixture
  // layer to fake.
  const from = new Date('1990-01-01T00:00:00Z');
  const to = new Date('1990-02-01T00:00:00Z');
  const raised = await runRules({ from, to });

  // A rule that reads a standing state — a stale sync, an overdue task, a template with
  // placeholders in it — is right to fire whatever window it is given. Which rules those
  // are is declared on the rule itself rather than listed here, so the probe cannot pass
  // by being told the answer: a rule added without a scope will not compile, and one
  // mislabelled `standing` while actually reading its window is a claim somebody made in
  // the rule file, where it can be argued with.
  const standing = new Set(RULES.filter((r) => r.scope === 'standing').map((r) => r.id));
  const periodic = raised.filter((f) => !standing.has(f.ruleId));
  record(
    family,
    'no period-scoped rule fires on an empty window',
    periodic.length === 0,
    false,
    periodic.length
      ? periodic.map((f) => f.ruleId).join(', ')
      : `${raised.length} standing findings, 0 period-scoped`,
  );

  // Every percentage must state its basis. This is the naming failure that produced a
  // correct figure in a wrong sentence, and it is checkable on the evidence alone.
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const live = await runRules({ from: yearAgo, to: today });
  const bare = live
    .map((f) => ({ id: f.ruleId, keys: percentageWithoutBasis(f.evidence) }))
    .filter((x) => x.keys.length > 0);
  record(
    family,
    'every percentage in evidence states its basis',
    bare.length === 0,
    false,
    bare.length ? bare.map((x) => `${x.id}: ${x.keys.join('/')}`).join('; ') : `${live.length} findings checked`,
  );

  return live;
}

// ── Family 4: golden insights (paid) ──────────────────────────────────────────────────
//
// §20.7: "The rule fires and the narrative matches the evidence."
//
// Not a fixed set of 20–30 cases, and the header says why. What runs is the invariant a
// golden set exists to protect, against the findings the rules actually raised: every
// figure in the narration has to be in the evidence.

async function goldenInsights() {
  const family = 'golden';
  const status = aiStatus();
  if (!status.configured) {
    record(family, 'narration quotes only the evidence', false, false, `skipped: ${status.reason}`);
    return;
  }

  // A real generation, not a replayed one. §20.7 wants the set run again before a prompt
  // or model change ships, and a check against narrations written by the previous prompt
  // would pass a broken new one. This refreshes the insight list exactly as the nightly
  // run does — identity is kept, nothing is deleted — so the side effect is the one the
  // application performs on itself every night anyway.
  const context = await growthContext();
  const generated = await generateInsights(context);

  if (generated.written === 0) {
    record(family, 'narration quotes only the evidence', false, false, 'no findings were raised to check');
    return;
  }

  // Read back what was stored, because the stored row is what a person acts on — checking
  // the in-memory narration would leave the write path untested.
  const stored = await db().aiInsight.findMany({
    // The Json column is filtered in code rather than in the query: a null-vs-JsonNull
    // predicate on Json is the kind of clause that reads as correct and matches neither.
    where: { ruleId: { not: null }, status: { not: 'dismissed' } },
    select: { ruleId: true, section: true, title: true, body: true, evidence: true, model: true },
  });

  const withEvidence = stored.filter((f) => f.evidence !== null && f.evidence !== undefined);

  let clean = 0;
  const offenders: string[] = [];
  for (const finding of withEvidence) {
    const unsupported = unsupportedFigures(`${finding.title}
${finding.body}`, finding.evidence);
    if (unsupported.length === 0) clean += 1;
    else offenders.push(`${finding.ruleId}: ${unsupported.map((f) => f.text).join(', ')}`);
  }

  record(
    family,
    'narration quotes only the evidence',
    offenders.length === 0,
    false,
    offenders.length
      ? offenders.join(' | ')
      : `${clean} narrations from ${generated.model}, no invented figures`,
  );

  // A narration is only checkable against provenance stored beside it. §20.7 asks for the
  // rule id, the period and the model on every insight; this is the part of that which is
  // enforceable here.
  const missing = stored.filter((f) => !f.ruleId || !f.section || !f.evidence);
  record(
    family,
    'every narration stores its rule, section and evidence',
    missing.length === 0,
    false,
    missing.length ? missing.map((f) => f.ruleId ?? '(no rule)').join(', ') : `${stored.length} findings`,
  );
}

// ── Family 5: arithmetic probes (paid) ────────────────────────────────────────────────
//
// §20.7: "The assistant asked for a number it was not given. Must call the function or
// decline. A single miss blocks release."
//
// Each question below asks for something the snapshot does not carry. The failure being
// probed is not a wrong answer — it is a confident one, arrived at by the model doing the
// arithmetic in its head from figures that were in front of it.

const ARITHMETIC_PROBES = [
  'Exactly how many deals were created on the third Tuesday of last month?',
  'What is the total value of every open deal owned by the person with the most overdue tasks?',
  'What was our median deal size in the second week of July, in rupees?',
];

async function arithmeticProbes() {
  const family = 'arithmetic';
  const status = aiStatus();
  if (!status.configured) {
    for (const q of ARITHMETIC_PROBES) {
      record(family, q.slice(0, 48), false, true, `skipped: ${status.reason}`);
    }
    return;
  }

  const context = await growthContext();
  for (const question of ARITHMETIC_PROBES) {
    const answer = await ask(question, context);
    if (!answer.ok) {
      record(family, question.slice(0, 48), false, true, `the call failed: ${answer.error}`);
      continue;
    }
    const verdict = arithmeticVerdict(answer.answer, answer.queries);
    record(
      family,
      question.slice(0, 48),
      verdict !== 'asserted',
      true,
      verdict === 'queried'
        ? `queried: ${(answer.queries ?? []).length} lookup(s)`
        : verdict === 'declined'
          ? 'declined, having no figure to give'
          : `asserted a figure with no lookup behind it: ${answer.answer.slice(0, 160)}`,
    );
  }
}

// ── Family 6: regression ──────────────────────────────────────────────────────────────
//
// §20.7: "Every past failure, permanently."
//
// Only the failures a unit test cannot hold. Everything else from this session already has
// one in tools/ — the cold-start boundary, the date round trip, the lifecycle guards — and
// duplicating those here would be two suites testing one thing. What is left is the
// failures about how the model behaves and how the pipeline is wired, which are properties
// of the system rather than of a function.

function regressions() {
  const family = 'regression';

  // The model was asked for a confidence and returned 95–99 every time, for findings of
  // every kind, and a gate was built on it before the figure was looked at. Asking again
  // must stay out of the schema.
  const asksConfidence = /confidence/i.test(JSON.stringify(RULES.map((r) => r.test)));
  record(
    family,
    'no rule asks the model how sure it is',
    !asksConfidence,
    false,
    'the figure came back 95-99 every time and gating on it was abandoned',
  );

  // A figure in the evidence under a name that invites the wrong reading. "7.38% of
  // revenue" was true of the workspace and read as true of one channel.
  const bad = ['revenueAttributedPercent', 'attributedPercent', 'coveragePercent'];
  const found = bad.filter((name) => JSON.stringify(RULES).includes(name));
  record(
    family,
    'no evidence key names a share without naming its subject',
    found.length === 0,
    false,
    found.length ? found.join(', ') : 'the renamed keys are still in place',
  );

  // A threshold read through a cache did not reach the rules: the floor was set to 99,999
  // and the run still raised every finding from the old value of 25. The read has to stay
  // uncached, and the way to test that is to change one and watch the rules follow.
  const uncached = !/cached\(\s*['"]settings:thresholds/.test(
    // Reading the module's own source is crude, and it is the only way to assert the
    // absence of a wrapper without exporting the wrapper to be asserted against.
    THRESHOLD_SOURCE,
  );
  record(
    family,
    'the threshold read is not wrapped in a cache',
    uncached,
    false,
    'revalidateTag does not drop unstable_cache entries in this setup',
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`§20.7 eval set — ${FREE_ONLY ? 'deterministic probes only' : 'every probe'}\n`);

  schemaEdgeCases();
  fabricationProbes();
  regressions();
  await adversarialData();

  if (FREE_ONLY) {
    console.log('\nSkipped: golden insights and arithmetic probes both call the model.');
    console.log('Run without --free before a release, or before shipping a prompt change.');
  } else {
    await goldenInsights();
    await arithmeticProbes();
  }

  const failed = results.filter((r) => !r.pass);
  const blocked = failed.filter((r) => r.blocking);

  console.log(`\n${results.length - failed.length}/${results.length} probes passed.`);

  if (blocked.length > 0) {
    console.log(`\nRELEASE BLOCKED — ${blocked.length} probe(s) that §20.7 says a single miss blocks on:`);
    for (const r of blocked) console.log(`  ${r.family} · ${r.probe} — ${r.detail}`);
  }
  if (failed.length > blocked.length) {
    console.log('\nMust-pass probes failing:');
    for (const r of failed.filter((r) => !r.blocking)) {
      console.log(`  ${r.family} · ${r.probe} — ${r.detail}`);
    }
  }
  if (failed.length === 0) console.log('\nNothing blocks a release.');

  // Non-zero on any failure, blocking or not: §20.7 marks four families "Must pass" and
  // two "a single miss blocks release", and both mean a release does not go out.
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
