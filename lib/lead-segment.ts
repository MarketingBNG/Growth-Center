// §7.4: the Segment field on Lead.
//
// The manual names four ICPs and says the content calendar, the webinar plan and the ad
// targeting are all built on them, so without the field none of the three can be
// measured. It does not say where the value comes from, and that turned out to be the
// interesting part: **Zoho holds no segment field**, and adding one for somebody to fill
// in by hand across 27,575 leads is a field that stays empty.
//
// It is already in the data. The Meta lead forms this account runs ask the person to
// describe themselves, and the answer is concatenated into `Description`, which the sync
// stores as `Lead.message`. 4,661 leads carry one. The exact strings, with counts read
// from the live database:
//
//   "I run a funded startup in India"                    — a founded Indian company
//   "I run a profitable bootstrapped company in India"    — likewise
//   "Indian founder planning Canada expansion"            — 364 leads and a paid campaign
//   "I'm just exploring the US market for now"            — an SME looking at the US
//
// So the classifier reads the answer the person actually gave, and says nothing where
// they gave none. Nothing here is inferred from a name or a country code.

/**
 * The segments, four from the manual and one this account demonstrably runs.
 *
 * `canada_expansion` is not in the manual and belongs here anyway: the firm runs a
 * `Leads_CanadaSetup_IndianFounders_July2026` campaign, 364 leads arrived through it, and
 * the lead form has its own answer for it. Folding those into "Indian SME entering the
 * US" would file a Canada programme under a US segment and make the mix on the dashboard
 * describe something nobody is running.
 *
 * `nri_hni` turned out to have a signal after all: "I'm an investor or HNWI planning a US
 * expansion" is one of the form's own answers, given by 58 leads. It was declared before
 * that was known, on the grounds that a value with a count of zero is a readable answer
 * to "how many NRI leads did we get" where a missing key reads as a bug.
 */
export const LEAD_SEGMENTS = [
  'indian_founded_us_entity',
  'us_company_india_ops',
  'nri_hni',
  'indian_sme_us_entry',
  'canada_expansion',
] as const;
export type LeadSegment = (typeof LEAD_SEGMENTS)[number];

export const SEGMENT_LABELS: Record<LeadSegment, string> = {
  indian_founded_us_entity: 'Indian-founded US entity',
  us_company_india_ops: 'US company with India operations',
  nri_hni: 'NRI / HNI',
  indian_sme_us_entry: 'Indian SME entering the US',
  canada_expansion: 'Indian founder, Canada expansion',
};

/**
 * The lead-form answers, longest first.
 *
 * Order matters and the list is sorted by specificity rather than by segment: "Indian
 * founder planning Canada expansion" contains neither "startup" nor "exploring", but a
 * shorter pattern matched first would claim a message that a longer one describes better.
 * Matching the most specific phrase first is the same precedence rule crm-mapping.ts
 * applies to source strings, and for the same reason.
 */
const ANSWERS: { pattern: RegExp; segment: LeadSegment }[] = [
  { pattern: /indian founder planning canada expansion/i, segment: 'canada_expansion' },
  { pattern: /canada (setup|expansion|incorporation)/i, segment: 'canada_expansion' },

  // A company that already exists in India and wants a US entity. Both answers describe
  // an operating business, which is what separates this from the exploratory segment.
  { pattern: /i run a funded startup in india/i, segment: 'indian_founded_us_entity' },
  { pattern: /i run a profitable bootstrapped company in india/i, segment: 'indian_founded_us_entity' },
  { pattern: /(funded startup|bootstrapped company) in india/i, segment: 'indian_founded_us_entity' },

  // A US company that needs work done in India — the reverse direction, and the one the
  // forms almost never produce. Kept narrow deliberately: a loose pattern here would
  // capture the majority segment, which points the other way.
  { pattern: /\b(us|u\.s\.|american) (company|entity|business) with india/i, segment: 'us_company_india_ops' },
  { pattern: /india (operations|subsidiary|back ?office|entity) for (a |our |my )?(us|u\.s\.)/i, segment: 'us_company_india_ops' },

  // "I'm an investor or HNWI planning a US expansion" is a real answer on this account's
  // forms — 58 leads gave it. The manual's fourth ICP does have a signal after all.
  { pattern: /investor or hnwi?|\bnri\b|non[- ]resident indian|\bhnwi?\b|high net[- ]worth/i, segment: 'nri_hni' },

  // Exploratory. Last, so an answer that also says the person runs a company is read as
  // the company rather than as the exploration.
  { pattern: /just exploring the us market/i, segment: 'indian_sme_us_entry' },
  { pattern: /company registration in u\.?s\.?/i, segment: 'indian_sme_us_entry' },
];

/**
 * The part of `message` that is the lead's own words.
 *
 * `Lead.message` is Zoho's Description field and holds three different things. 3,967
 * leads carry a single-line concatenation of their lead-form answers — the lead speaking.
 * 694 carry the **outbound broadcast that was sent to them**, ad copy the firm wrote:
 * "Launch your US business from India — fully online". Some carry an owner's note.
 *
 * Reading the second kind as the lead's intent is a real error, not a tidiness one. The
 * broadcast copy contains "company registration" and every state name the intent rules
 * look for, so 694 leads would have scored highly for words the firm typed at them.
 *
 * A newline separates the two cleanly: form answers are concatenated onto one line and
 * every broadcast is multi-line marketing copy. Checked against all 4,661 messages rather
 * than assumed, which is why the test is this blunt one rather than a keyword list.
 *
 * Lost reason deliberately does not use this. An owner's note is where "the client is not
 * willing to proceed" lives, and that is evidence about the outcome rather than a claim
 * the lead made about themselves.
 */
export function leadStatement(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.includes('\n') || message.includes('\r')) return null;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The segment a lead declared, or null.
 *
 * Null is a real answer and is stored as null rather than as an "unknown" member of the
 * set. 22,914 leads carry no message at all — mostly WhatsApp and chat threads that never
 * present a form — and inventing a segment for them would put four fifths of the lead
 * base into whichever bucket the fallback chose.
 */
export function segmentOf(message: string | null | undefined, sourceDetail?: string | null): LeadSegment | null {
  const haystack = `${leadStatement(message) ?? ''} ${sourceDetail ?? ''}`.trim();
  if (!haystack) return null;

  for (const { pattern, segment } of ANSWERS) {
    if (pattern.test(haystack)) return segment;
  }
  return null;
}

export function isLeadSegment(value: unknown): value is LeadSegment {
  return typeof value === 'string' && (LEAD_SEGMENTS as readonly string[]).includes(value);
}

export const segmentLabel = (value: string | null | undefined) =>
  isLeadSegment(value) ? SEGMENT_LABELS[value] : 'Unsegmented';
