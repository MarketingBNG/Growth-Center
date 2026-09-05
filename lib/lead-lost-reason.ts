// §7.6: "Lost-reason taxonomy, mandatory on Dead or Lost: Not ICP / Price / Timing /
// No response / Competitor / Wrong geography."
//
// The manual's "done when" is "no lead can be closed lost without a reason", which is a
// rule about the future. It leaves 11,762 leads already closed lost with nothing recorded
// — and those are the ones the "why we lose" analysis the clause exists to serve would
// actually run over.
//
// It turns out most of them do say. This organisation's Zoho `Lead_Status` picklist is
// doing the job of a lost-reason field, and the sync already stores it verbatim in
// `sourceStatus`. Counts from the live database:
//
//   Dead Lead        9,867     Not Reachable    6,305
//   Lead Lost        1,895     Looking For Job    116
//
// "Not Reachable" is `no_response` stated in the CRM's own words. "Looking For Job" is
// `not_icp` — a job applicant is not a prospective client, and 116 of them were sitting
// in the lead base being counted as leads the marketing spend had failed to convert.
//
// So the taxonomy is the manual's six, plus one the data forces: `unstated`. "Dead Lead"
// says the lead is dead and does not say why, and mapping 9,867 of those onto one of the
// six would manufacture the concentration the lost-reason insight is looking for.

export const LOST_REASONS = [
  'not_icp',
  'price',
  'timing',
  'no_response',
  'competitor',
  'wrong_geography',
  /**
   * Closed lost with no reason given.
   *
   * The largest bucket today, and it has to be visible. Dropping these would let the
   * lost-reason concentration rule report that 62% of losses are "no response" when the
   * truth is that 62% of the losses that say anything are, over a fifth of the book.
   */
  'unstated',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  not_icp: 'Not our client',
  price: 'Price',
  timing: 'Timing',
  no_response: 'No response',
  competitor: 'Competitor',
  wrong_geography: 'Wrong geography',
  unstated: 'No reason given',
};

/**
 * Zoho status strings and free text, mapped onto the taxonomy.
 *
 * Longest and most specific first. `no_response` is checked before the generic dead-lead
 * patterns because "Dead Lead - not reachable" says both, and the specific half is the
 * one worth keeping.
 */
const PATTERNS: { pattern: RegExp; reason: LostReason }[] = [
  { pattern: /not reachable|unreachable|no (response|reply|answer)|not answering|never responded|wrong number/i, reason: 'no_response' },
  { pattern: /looking for (a )?job|job seeker|candidate|applicant|resume|cv\b|internship/i, reason: 'not_icp' },
  { pattern: /not (our )?icp|not a fit|not relevant|irrelevant|spam|test lead|student/i, reason: 'not_icp' },
  { pattern: /budget|too expensive|price|pricing|cost(ly)?|cheaper/i, reason: 'price' },
  { pattern: /timing|too early|later|postponed|not now|next (year|quarter)|on hold/i, reason: 'timing' },
  { pattern: /competitor|went with|another (firm|provider|consultant)|already (has|have|working with)/i, reason: 'competitor' },
  { pattern: /geograph|wrong (country|region|location)|outside (our )?(scope|market)|we do not serve/i, reason: 'wrong_geography' },
  // Last: says the lead is lost and says nothing about why.
  { pattern: /dead lead|lead lost|\blost\b|closed lost|junk/i, reason: 'unstated' },
];

/**
 * The reason a lead was lost, or null when it was not lost.
 *
 * Reads the CRM's own status first and the free text second, because the status is a
 * picklist somebody chose and the note is whatever they typed. Returns `unstated` — never
 * null — for a lead that is lost and says nothing, so "we looked and it does not say"
 * stays distinguishable from "this lead is not lost".
 */
export function lostReasonOf(input: {
  status: string;
  sourceStatus?: string | null;
  message?: string | null;
}): LostReason | null {
  // `unqualified` is lost for this purpose. It is where the 116 job applicants sit, and
  // excluding it would drop the clearest not-ICP evidence the database holds.
  if (input.status !== 'lost' && input.status !== 'unqualified') return null;

  // Named reasons across both sources first, and only then the fallback.
  //
  // Iterating source-by-source instead put `unstated` ahead of everything the note said:
  // "Dead Lead" matches the fallback pattern, so a lead whose owner had written "went
  // with a cheaper firm" was filed as giving no reason. The picklist still outranks the
  // note — `sourceStatus` is first in the inner loop — but only among the reasons that
  // actually say something.
  for (const { pattern, reason } of PATTERNS) {
    if (reason === 'unstated') continue;
    for (const source of [input.sourceStatus, input.message]) {
      if (source && pattern.test(source)) return reason;
    }
  }
  return 'unstated';
}

export function isLostReason(value: unknown): value is LostReason {
  return typeof value === 'string' && (LOST_REASONS as readonly string[]).includes(value);
}

export const lostReasonLabel = (value: string | null | undefined) =>
  isLostReason(value) ? LOST_REASON_LABELS[value] : '—';
