/**
 * The facts gate.
 *
 * The engine's first non-negotiable, in code: **the model never originates a tax number.**
 * A threshold, penalty, deadline, rate or form reference reaches a draft only through a
 * placeholder — `{{fact:US-FBAR-THRESHOLD}}` — that resolves to an approved row in the
 * register. A figure typed straight into the prose blocks the draft.
 *
 * Pure. No database, no model call, no I/O. That is the point: this is the rule that
 * everything else defers to, so it has to be readable in one file and testable on strings.
 * Reading the register lives in lib/content/facts-store.ts.
 *
 * ## Why a scanner and not just placeholders
 *
 * Requiring placeholders only tells you that the placeholders used were valid. It says
 * nothing about the $10,000 somebody typed next to one. The scanner is the half that
 * catches what was *not* declared, and it is the half that will annoy people, so what it
 * looks for is deliberate and written down below.
 */

/** `US-FBAR-THRESHOLD`. Upper-case, digits and dashes; must start with a letter. */
export const FACT_KEY_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;

/** `{{fact:KEY}}`, tolerating inner spaces because people type them. */
const PLACEHOLDER = /\{\{\s*fact:\s*([^}\s]+)\s*\}\}/g;

export type FactLike = {
  key: string;
  value: string;
  status: string;
  numericValue?: number | null;
};

export type Placeholder = { key: string; raw: string; index: number };

/** Every `{{fact:…}}` in the text, in the order they appear. */
export function parsePlaceholders(text: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    found.push({ key: match[1], raw: match[0], index: match.index ?? 0 });
  }
  return found;
}

export type RenderResult = {
  /** The text with every resolvable placeholder replaced by its value. */
  text: string;
  /** Placeholders naming a key the register does not hold. */
  missing: string[];
  /** Placeholders naming a real fact that is not approved. */
  unapproved: { key: string; status: string }[];
  /** Keys that were resolved, for the record kept against the draft. */
  used: string[];
};

/**
 * Replaces placeholders with their approved values.
 *
 * An unresolvable placeholder is **left in the text exactly as written**, never blanked
 * and never guessed at. A missing fact that silently rendered as an empty string would
 * produce "the threshold is " — a sentence that reads like an editing slip rather than a
 * blocked draft, and one that has a decent chance of being published.
 */
export function renderFacts(text: string, facts: FactLike[]): RenderResult {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const missing: string[] = [];
  const unapproved: { key: string; status: string }[] = [];
  const used: string[] = [];

  const rendered = text.replace(PLACEHOLDER, (raw, key: string) => {
    const fact = byKey.get(key);
    if (!fact) {
      if (!missing.includes(key)) missing.push(key);
      return raw;
    }
    if (fact.status !== 'approved') {
      if (!unapproved.some((u) => u.key === key)) unapproved.push({ key, status: fact.status });
      return raw;
    }
    if (!used.includes(key)) used.push(key);
    return fact.value;
  });

  return { text: rendered, missing, unapproved, used };
}

// ── the scanner ──────────────────────────────────────────────────────────────────────

export type TokenFinding = {
  /** The text that tripped it. */
  token: string;
  kind: 'money' | 'percentage' | 'form' | 'deadline';
  index: number;
  /** Why it is a finding, in words an author can act on. */
  reason: string;
};

/**
 * What the scanner looks for, and what it deliberately ignores.
 *
 * It flags four kinds of token, chosen because each one is a claim about law that a reader
 * may act on:
 *
 *   **money** — `$10,000`, `₹5,00,000`, `USD 1,200`
 *   **percentage** — `21%`, `37.5 per cent`
 *   **form** — `Form 5471`, `Schedule K-1`, `W-8BEN`, `FBAR`, `FinCEN 114`
 *   **deadline** — `15 April`, `April 15`, `31 December`
 *
 * It does **not** flag bare integers, years, ordinals or counts. "Three things to know",
 * "in 2026", "the second test" and "5 steps" are prose, and a gate that blocks them is a
 * gate somebody turns off. The cost of that choice is stated plainly: a bare number that
 * IS a threshold — "the limit is 10000" — passes. Nothing here can tell that from a word
 * count, and the mitigation is the reviewer, not the regex.
 */

const MONEY = /(?:(?:US\$|₹|\$|INR|USD|Rs\.?)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|INR|dollars|rupees|lakh|crore))/gi;
const PERCENTAGE = /\d+(?:\.\d+)?\s?(?:%|per\s?cent)/gi;
const FORM =
  /\b(?:Form\s+[A-Z0-9][\w-]*|Schedule\s+[A-Z][\w-]*|W-8[A-Z]*|W-9|1099(?:-[A-Z]+)?|FBAR|FinCEN\s+\d+|ITR-?\d)\b/g;
const MONTHS =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DEADLINE = new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}|${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`, 'g');

const KINDS: [RegExp, TokenFinding['kind'], string][] = [
  [MONEY, 'money', 'A monetary figure must come from the facts register, not the draft.'],
  [PERCENTAGE, 'percentage', 'A rate must come from the facts register, not the draft.'],
  [FORM, 'form', 'A form reference must come from the facts register, not the draft.'],
  [DEADLINE, 'deadline', 'A filing date must come from the facts register, not the draft.'],
];

/**
 * Spans of the text that came from a placeholder, and are therefore already vouched for.
 *
 * Computed against the *rendered* text: once `{{fact:US-FBAR-THRESHOLD}}` has become
 * `$10,000`, the scanner would otherwise flag that very substitution as an undeclared
 * figure — the register's own approved value reported as a violation.
 */
function resolvedSpans(text: string, facts: FactLike[]): [number, number][] {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const spans: [number, number][] = [];
  let cursor = 0;
  let out = 0;

  // Walk the original and the rendered text together, tracking where each substitution
  // landed. Cheaper and far less fragile than re-finding the values afterwards, which
  // would also match a coincidentally identical figure elsewhere in the prose.
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index ?? 0;
    out += at - cursor;
    const fact = byKey.get(match[1]);
    const replacement = fact && fact.status === 'approved' ? fact.value : match[0];
    spans.push([out, out + replacement.length]);
    out += replacement.length;
    cursor = at + match[0].length;
  }
  return spans;
}

const inside = (index: number, length: number, spans: [number, number][]) =>
  spans.some(([from, to]) => index >= from && index + length <= to);

/**
 * Figures in the draft that no approved fact stands behind.
 *
 * Runs against the rendered text, with the spans that came from the register excluded. A
 * non-empty result blocks the draft; §3.1 is a hard fail, not a warning.
 */
export function scanUnverifiedTokens(text: string, facts: FactLike[] = []): TokenFinding[] {
  const { text: rendered } = renderFacts(text, facts);
  const safe = resolvedSpans(text, facts);
  const findings: TokenFinding[] = [];

  for (const [pattern, kind, reason] of KINDS) {
    for (const match of rendered.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (inside(index, match[0].length, safe)) continue;
      findings.push({ token: match[0], kind, index, reason });
    }
  }

  // Ordered by position so an author reads them in the order they appear in their own
  // draft, and deduplicated on the exact span so two patterns matching the same text
  // (a form number that is also a figure) is one finding.
  const seen = new Set<string>();
  return findings
    .sort((a, b) => a.index - b.index)
    .filter((f) => {
      const id = `${f.index}:${f.token}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export type GateResult = {
  /** False blocks the draft. */
  ok: boolean;
  rendered: string;
  missing: string[];
  unapproved: { key: string; status: string }[];
  undeclared: TokenFinding[];
  used: string[];
  /** One line saying why, for the button that refused. */
  summary: string;
};

/**
 * The whole gate, as one call: resolve the placeholders, then scan what is left.
 *
 * This is what the publish path and the draft save both use, so there is exactly one
 * answer to "may this go out" rather than two that can drift.
 */
export function checkFacts(text: string, facts: FactLike[]): GateResult {
  const { text: rendered, missing, unapproved, used } = renderFacts(text, facts);
  const undeclared = scanUnverifiedTokens(text, facts);
  const ok = !missing.length && !unapproved.length && !undeclared.length;

  const problems: string[] = [];
  if (missing.length) problems.push(`${missing.length} unknown fact${missing.length === 1 ? '' : 's'} (${missing.join(', ')})`);
  if (unapproved.length) {
    problems.push(
      `${unapproved.length} fact${unapproved.length === 1 ? '' : 's'} not cleared by a reviewer (${unapproved.map((u) => u.key).join(', ')})`,
    );
  }
  if (undeclared.length) {
    problems.push(
      `${undeclared.length} figure${undeclared.length === 1 ? '' : 's'} with no approved fact behind ${undeclared.length === 1 ? 'it' : 'them'} (${undeclared.slice(0, 3).map((f) => f.token).join(', ')}${undeclared.length > 3 ? '…' : ''})`,
    );
  }

  return {
    ok,
    rendered,
    missing,
    unapproved,
    undeclared,
    used,
    summary: ok ? 'Every figure in this draft resolves to an approved fact.' : problems.join('; ') + '.',
  };
}
