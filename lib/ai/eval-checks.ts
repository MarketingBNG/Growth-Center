// §20.7's probes, as deterministic checks.
//
// Pure and model-free on purpose. The probes that need a model call live in tools/eval.ts
// and pay for a request; everything here runs for nothing, which matters because §20.7
// says the set must pass "before release, and again before any prompt or model change
// ships". A suite nobody can afford to run is a suite nobody runs.
//
// ── The check that carries the weight ─────────────────────────────────────────────────
//
// The rules compute the figures and the model writes only prose about them. That contract
// is worth nothing unless something verifies it, and a human reading two sentences cannot
// reliably tell a figure that came from the evidence from one that came from the model's
// sense of what a plausible number looks like. `unsupportedFigures` is that verifier: it
// reads every number out of the narration and refuses any that is not in the evidence.
//
// ── What it does not catch, stated rather than discovered ────────────────────────────
//
// Digits only. "The top three channels" is a claim and passes; "the top 3" does not. The
// figures that matter in these narrations are written as digits, because the evidence
// hands the model numbers — but a prose count is a hole, and a gate whose limits are not
// written down gets believed past them.
//
// Nor does it catch a correct figure in a wrong sentence, which is the harder failure:
//
// It has already caught a real failure. Given a key named `revenueAttributedPercent`, the
// model wrote "the channel is associated with 7.38% of revenue" — the figure was in the
// evidence and the sentence was still wrong, because 7.38% was a workspace-wide share and
// the name invited reading it as one channel's. That one is a naming failure this cannot
// catch, which is exactly why the checks below are the floor and not the ceiling.

/** A number as it was written, and its value. */
export type Figure = { text: string; value: number };

/**
 * Every number in a piece of prose.
 *
 * Currency symbols, commas and percent signs are stripped, so "₹1,018,768" and "203.75%"
 * both come back as plain values — the narration writes them formatted and the evidence
 * holds them raw, and a comparison that missed that would flag every correct figure.
 *
 * Ordinals and units attached to a digit ("Q3", "48h") are numbers too, and deliberately
 * so: "48 hours" in a narration where the threshold is 24 is precisely the kind of quiet
 * substitution this exists to catch.
 */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  // Digits, optionally with thousands separators and a decimal part. The leading sign is
  // deliberately not matched: "down -12%" and "down 12%" mean the same thing to a reader,
  // and treating the minus as part of the figure made a correct narration of a negative
  // change read as unsupported.
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, '');
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ text: m[0], value });
  }
  return out;
}

/**
 * Every number anywhere in an evidence object, however deeply nested.
 *
 * Strings are mined as well as numbers. Evidence routinely carries a formatted figure or a
 * label with a number in it — a period of "Q3 2026", an owner's task count in a sentence —
 * and treating those as absent would flag a narration for quoting the evidence verbatim.
 */
export function figuresInEvidence(evidence: unknown, depth = 0): Set<number> {
  const out = new Set<number>();
  // A guard, not a limit anybody should reach: evidence is built by the rules from query
  // results, and a cycle would hang the release gate rather than fail it.
  if (depth > 8 || evidence === null || evidence === undefined) return out;

  if (typeof evidence === 'number') {
    if (Number.isFinite(evidence)) out.add(evidence);
    return out;
  }
  if (typeof evidence === 'string') {
    for (const f of figuresIn(evidence)) out.add(f.value);
    return out;
  }
  if (Array.isArray(evidence)) {
    for (const item of evidence) for (const n of figuresInEvidence(item, depth + 1)) out.add(n);
    return out;
  }
  if (typeof evidence === 'object') {
    for (const value of Object.values(evidence)) {
      for (const n of figuresInEvidence(value, depth + 1)) out.add(n);
    }
  }
  return out;
}

/**
 * Whether a narrated figure is one the evidence actually contains.
 *
 * Rounding is allowed and nothing else. A narration that says 204% where the evidence says
 * 203.75% is doing what a writer should; one that says 210% is inventing, and the gap
 * between those two is the whole judgement this function makes.
 *
 * Rounding is checked in both directions — the narration may round the evidence, and the
 * evidence may already be rounded from a figure the narration states in full. Percentage
 * points are also allowed to be dropped ("113%" from 113.4), since that is the same
 * operation at a different precision.
 */
export function isSupported(value: number, evidence: Set<number>): boolean {
  for (const known of evidence) {
    if (value === known) return true;
    // Either direction, at every precision a writer plausibly uses.
    for (const dp of [0, 1, 2]) {
      const factor = 10 ** dp;
      if (Math.round(known * factor) / factor === value) return true;
      if (Math.round(value * factor) / factor === known) return true;
    }
    // Truncation as well as rounding: "203%" from 203.75 is a writer being conservative,
    // not a writer inventing.
    if (Math.trunc(known) === value) return true;
  }
  return false;
}

/**
 * Figures in the narration that the evidence does not support.
 *
 * Empty is a pass. Anything else is the model having produced a number of its own, which
 * §20.1 forbids and which is the single failure that would make every finding on the page
 * untrustworthy rather than merely wrong.
 *
 * Deliberately strict, including about figures a reader would wave through. A "top 3" in a
 * narration whose evidence has no 3 in it is the model deciding how many there were.
 */
export function unsupportedFigures(narration: string, evidence: unknown): Figure[] {
  const known = figuresInEvidence(evidence);
  const seen = new Set<number>();
  const out: Figure[] = [];
  for (const figure of figuresIn(narration)) {
    if (seen.has(figure.value)) continue;
    seen.add(figure.value);
    if (!isSupported(figure.value, known)) out.push(figure);
  }
  return out;
}

// ── Adversarial data ──────────────────────────────────────────────────────────────────
//
// §20.7: contradictory or missing rows "must degrade to a deferral, not a guess". For the
// rules that means something stricter and simpler than a deferral: a rule with nothing to
// measure must not fire at all. A rule that fires on an empty table produces a finding
// whose evidence is a set of zeros, and a zero reads as a measurement.

export type FiringCheck = { fired: boolean; evidence?: unknown };

/**
 * Whether a rule handed nothing to measure correctly stayed silent.
 *
 * A rule that fired is a failure. So is one that stayed silent but returned evidence
 * anyway, because the next reader of that evidence has no way to know it was never used.
 */
export function deferredCorrectly(check: FiringCheck): boolean {
  return !check.fired;
}

/**
 * Whether an evidence object states its own basis.
 *
 * The lesson from `revenueAttributedPercent`: a percentage with no statement of what it is
 * a percentage of will be read as a percentage of whatever the reader was already thinking
 * about. Any evidence carrying a percentage must also carry a `basis`.
 */
export function percentageWithoutBasis(evidence: unknown): string[] {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
  const keys = Object.keys(evidence as Record<string, unknown>);
  const hasBasis = keys.some((k) => k.toLowerCase().includes('basis'));
  if (hasBasis) return [];
  return keys.filter((k) => /percent|pct|rate|share/i.test(k));
}

// ── Arithmetic probes ─────────────────────────────────────────────────────────────────
//
// §20.7: asked for a number it was not given, the assistant "must call the function or
// decline. A single miss blocks release." Both halves are checkable without reading the
// prose: the answering path reports which queries it ran, so calling the function leaves a
// trace, and declining is a statement about what the data does not contain.

const DECLINED = [
  /\bcannot\b/i,
  /\bcan'?t\b/i,
  /\bdo(es)? not (contain|include|have|record|track)\b/i,
  /\bis not (recorded|tracked|stored|available|in the)\b/i,
  /\bno (data|figure|record|field|signal)\b/i,
  /\bnot available\b/i,
  /\bunable to\b/i,
];

export type ArithmeticVerdict = 'queried' | 'declined' | 'asserted';

/**
 * How the assistant handled a question whose answer was not in front of it.
 *
 * `asserted` is the failure: a figure produced with neither a lookup behind it nor an
 * admission that there was none. A bare number is the worst possible answer here, because
 * it is indistinguishable from a correct one.
 *
 * A declining answer that also ran a query counts as `queried`: looking first and then
 * saying the data does not answer it is the behaviour §20.7 actually wants.
 */
export function arithmeticVerdict(answer: string, queries: string[] | undefined): ArithmeticVerdict {
  if (queries && queries.length > 0) return 'queried';
  if (DECLINED.some((re) => re.test(answer))) return 'declined';
  return 'asserted';
}
