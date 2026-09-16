/**
 * Does a narration only name identifiers it was actually given?
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────
 *
 * Manual v3.0 raised D1: every SEO and PageSpeed insight cited `usaindiancfo.com`, an
 * extra "n", and the manual concluded the SEO jobs might be measuring somebody else's
 * website — "every SEO finding describes someone else's site and must be regenerated".
 *
 * They are not. The Search Console property is `https://usaindiacfo.com/` and all 256
 * seo_page rows carry that host. The rule handed the model a correct URL in `evidence`
 * and the model retyped it wrong in prose. The dataset was never the problem; the last
 * step before storage was.
 *
 * That is worth a permanent control rather than a one-off correction, because the failure
 * is invisible in exactly the way that matters: a plausible domain in fluent prose reads
 * as a fact, and it cost a reading of the application a defect that was never there.
 *
 * ── What it checks, and what it deliberately does not ─────────────────────────────────
 *
 * Identifiers only: hosts, URLs and email addresses. Every one appearing in a narration
 * must appear in that finding's own evidence. This is the check that catches D1 and it
 * has no judgement in it — a token is present in the evidence or it is not.
 *
 * It does not check numerals. §7.3 wants that too, and it is a harder problem than it
 * looks: evidence carries `ctrPercent: 0.72` while good prose writes "0.72%", and a
 * naive matcher would reject correct narrations and teach everyone to ignore it. That
 * check belongs with the pre-review passes in K8, built against the eval set, where a
 * false rejection shows up as a failing probe instead of as a silently dropped insight.
 *
 * A failure is not fatal. lib/ai.ts already falls back to the rule's own wording when the
 * model is unreachable, and that fallback is the right answer here too: worse prose,
 * exactly as true.
 */

/**
 * Hosts, URLs and email addresses.
 *
 * The label before the dot must start with a letter and the last label must be alphabetic
 * and at least two characters, which keeps figures ("0.72", "1,534.5") and sentence-ending
 * abbreviations ("e.g.") out of the results without needing a list of TLDs.
 */
const IDENTIFIER = /\b(?:https?:\/\/)?[a-z][a-z0-9-]*(?:[.@][a-z0-9-]+)*\.[a-z]{2,}\b(?:\/[^\s,;)"']*)?/gi;

/** Trailing punctuation a sentence leaves attached to a URL. */
const trimTail = (token: string) => token.replace(/[.,;:!?)"'\]]+$/, '');

/**
 * Identifiers in `text` that do not occur anywhere in `evidence`.
 *
 * Comparison is case-insensitive and ignores a scheme and a trailing slash, so a model
 * writing `https://example.com/page` for an evidence value of `example.com/page/` is not
 * reported. Nothing else is normalised: a single wrong character is the whole point.
 */
export function unsupportedIdentifiers(text: string, evidence: Record<string, unknown>): string[] {
  const haystack = JSON.stringify(evidence).toLowerCase();
  const bare = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const missing = new Set<string>();
  for (const raw of text.match(IDENTIFIER) ?? []) {
    const token = trimTail(raw);
    if (!token) continue;
    if (!haystack.includes(bare(token))) missing.add(token);
  }
  return [...missing];
}
