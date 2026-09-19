/**
 * Stripping people out of a sales call.
 *
 * WP07 turns call transcripts into buyer language — the phrases prospects actually use,
 * which is the strongest signal for what to write. The transcripts themselves are
 * recordings of named clients discussing their tax affairs, and §3.12 is blunt about it:
 * no client-identifiable data in content tables, prompts or published pages.
 *
 * So nothing reaches an extraction prompt, an aggregate table or a screen without passing
 * through here first. This runs **before** the model, not after — a model asked nicely not
 * to repeat names is a request, and this is a guarantee.
 *
 * Pure and deterministic. That is the whole point: a scrubber that depends on a model to
 * decide what is a name has the same failure mode as the thing it is protecting against.
 *
 * ## What it cannot do
 *
 * It cannot recognise a name it has never been told about. "I spoke to Rajesh" is scrubbed
 * only if Rajesh is in the known-names list the caller passes in — which is why the caller
 * is expected to pass every name, company and email Zoho holds for that call's participants
 * and lead. Pattern-matching catches the shapes (emails, phones, tax ids); the list catches
 * the people. Neither alone is enough, and the tests say so.
 */

/** What the caller knows about who was on the call, from Zoho and from Fireflies itself. */
export type KnownParties = {
  /** Personal and company names. Matched case-insensitively, on word boundaries. */
  names?: string[];
  emails?: string[];
};

export type ScrubResult = {
  text: string;
  /** What kind of thing was removed, and how many. For the audit line, never the values. */
  removed: Record<string, number>;
};

/** Each replacement says what was taken out, so a scrubbed line still reads as a sentence. */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Phone numbers, loosely.
 *
 * Deliberately greedy about separators and lengths because the transcripts carry US and
 * Indian numbers in half a dozen formats, and a missed phone number is worse than an
 * over-scrubbed figure. A revenue figure wrongly redacted costs a phrase; a leaked mobile
 * number is a client's contact details in a content table.
 */
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,4}[\s.-]?\d{0,4}\b/g;

/**
 * Government identifiers, US and Indian.
 *
 * SSN and ITIN share a shape (NNN-NN-NNNN), EIN is NN-NNNNNNN, PAN is five letters, four
 * digits, a letter, and Aadhaar is twelve digits usually spoken in groups of four. All are
 * matched on shape; none of them needs to be recognised as belonging to anyone.
 */
const SSN_ITIN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EIN = /\b\d{2}-\d{7}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const AADHAAR = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;

/** Escapes a known name so it can go into a regex without its punctuation meaning anything. */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes everything identifying from a passage of transcript.
 *
 * Order matters and is not arbitrary. Emails go first because an address contains a name
 * and a dot-separated surname that the name pass would otherwise half-eat, leaving a
 * fragment. Tax identifiers go before the phone pattern, because an EIN and a PAN are both
 * digit runs a loose phone regex would happily claim and relabel — and "[phone]" where an
 * EIN stood is a scrub that hides what kind of thing was removed.
 */
export function scrubTranscript(text: string, known: KnownParties = {}): ScrubResult {
  const removed: Record<string, number> = {};
  let out = text;

  const apply = (pattern: RegExp, label: string, tag: string) => {
    out = out.replace(pattern, () => {
      removed[label] = (removed[label] ?? 0) + 1;
      return tag;
    });
  };

  apply(EMAIL, 'emails', '[email]');
  apply(SSN_ITIN, 'taxIds', '[tax id]');
  apply(EIN, 'taxIds', '[tax id]');
  apply(PAN, 'taxIds', '[tax id]');
  apply(AADHAAR, 'taxIds', '[tax id]');
  apply(PHONE, 'phones', '[phone]');

  // Known names last: by now the addresses that contained them are gone, so a name match
  // is a name in the prose rather than a fragment of something already replaced.
  //
  // Longest first, so "Acme Consulting Pvt Ltd" is replaced whole rather than having
  // "Acme" taken out of the middle of it and the rest left standing.
  const names = [...(known.names ?? [])]
    .map((n) => n.trim())
    .filter((n) => n.length > 2)
    .sort((a, b) => b.length - a.length);

  for (const name of names) {
    const pattern = new RegExp(`\\b${escape(name)}\\b`, 'gi');
    apply(pattern, 'names', '[name]');
  }

  // Addresses the caller listed that were not in the text as addresses — a bare local part
  // spoken aloud, say. Cheap, and the alternative is a known address surviving because it
  // was written without its domain.
  for (const address of known.emails ?? []) {
    const local = address.split('@')[0]?.trim();
    if (!local || local.length < 3) continue;
    apply(new RegExp(`\\b${escape(local)}\\b`, 'gi'), 'names', '[name]');
  }

  return { text: out, removed };
}

/**
 * Whether anything identifying survived.
 *
 * The second half of the guarantee, and the one that runs in the test the pack asks for.
 * A scrubber is only as good as its assertion: this re-checks the output against the same
 * patterns and the same known list, so a bug in `scrubTranscript` shows up as a failed
 * verification rather than as clean-looking output.
 *
 * Used as a hard gate by the caller — text that fails this must not be stored or sent to a
 * model, whatever the scrubber thought it did.
 */
export function verifyScrubbed(text: string, known: KnownParties = {}): string[] {
  const leaks: string[] = [];

  const check = (pattern: RegExp, label: string) => {
    const found = text.match(pattern);
    if (found?.length) leaks.push(`${label} (${found.length})`);
  };

  check(EMAIL, 'email address');
  check(SSN_ITIN, 'SSN or ITIN');
  check(EIN, 'EIN');
  check(PAN, 'PAN');
  check(AADHAAR, 'Aadhaar number');
  check(PHONE, 'phone number');

  for (const name of known.names ?? []) {
    const trimmed = name.trim();
    if (trimmed.length <= 2) continue;
    if (new RegExp(`\\b${escape(trimmed)}\\b`, 'i').test(text)) leaks.push(`the name "${trimmed}"`);
  }

  return leaks;
}

/**
 * Scrubs, then refuses to return anything that did not come out clean.
 *
 * The function callers should use. Returning partly-scrubbed text with a warning attached
 * puts the decision at every call site, and one of them will get it wrong — this makes the
 * failure loud at the only point where it is still cheap.
 */
export class PiiLeakError extends Error {
  // Declared rather than written as a constructor parameter property: `node --test
  // --experimental-strip-types` runs this suite, and strip-only mode cannot compile one.
  readonly leaks: string[];

  constructor(leaks: string[]) {
    super(`Transcript still contains identifying data after scrubbing: ${leaks.join(', ')}.`);
    this.name = 'PiiLeakError';
    this.leaks = leaks;
  }
}

export function scrubOrThrow(text: string, known: KnownParties = {}): ScrubResult {
  const result = scrubTranscript(text, known);
  const leaks = verifyScrubbed(result.text, known);
  if (leaks.length) throw new PiiLeakError(leaks);
  return result;
}
