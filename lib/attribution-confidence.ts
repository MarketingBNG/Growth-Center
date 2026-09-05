import type { SourceType } from './generated/prisma/client.ts';
import { channelSlugFor, leadSourceGroup } from './integrations/crm-mapping.ts';

// G1.2 asks for `Attribution_Confidence` on Lead and Deal, and there was no column at
// all. Every channel figure in the app therefore treated "this lead said it came from
// Instagram" and "this lead's source string was unfamiliar, but the enum guessed website,
// so call it Direct" as equally certain facts.
//
// They are not. `channelSlugFor` reaches a channel by three quite different routes, and
// only the first of them is the record saying where it came from:
//
//   1. the source string matched a rule written against this account's own 56 measured
//      Zoho source strings — "Incorporation LinkdIn", misspelling and all;
//   2. the string meant nothing here, but the CRM's `sourceType` enum knew a category —
//      "Trade Show" is an event, "Web Download" a website;
//   3. neither, and the lead reaches no channel.
//
// Measured over all 27,575 leads once the column existed, the answer was not what the
// design expected: **27,466 reported, 109 none, and not a single inferred one.** This
// account's CRM states a source string the mapping recognises on essentially every lead.
//
// That is worth having written down rather than deleted. It says the lead-side weakness
// the audit measured at 99.6% coverage is not a confidence problem at all, and that the
// whole of the attribution doubt sits on the deal side — where 90% of deals were never
// converted from a lead and revenue coverage is 10.2%. `inheritedConfidence` below is
// therefore the part of this file that does the work.

/**
 * Three values, ordered.
 *
 * - `reported` — the source says so. The record carries a string this account's own
 *   mapping recognises.
 * - `inferred` — derived from the CRM's coarse enum after the string failed. Real
 *   evidence, weaker evidence.
 * - `none` — nothing reached a channel. Stored rather than left null so "we looked and
 *   found nothing" is distinguishable from "nothing has looked yet", which is what a
 *   null on 27,458 rows would have meant.
 */
export const ATTRIBUTION_CONFIDENCE = ['reported', 'inferred', 'none'] as const;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCE)[number];

/**
 * The channel a lead reaches, and how much the answer is worth.
 *
 * One function returning both, deliberately. Computing the slug in one place and the
 * confidence in another is how the two come to disagree — and a confidence that does not
 * describe the slug beside it is worse than no confidence at all, because it looks like
 * corroboration.
 */
export function resolveAttribution(
  sourceType: SourceType,
  sourceDetail?: string | null,
): { slug: string | null; confidence: AttributionConfidence } {
  const slug = channelSlugFor(sourceType, sourceDetail);
  if (slug === null) return { slug: null, confidence: 'none' };

  // The same test channelSlugFor makes first. A group that is neither `other` nor
  // `unattributed` means a rule matched the account's own source string.
  const group = leadSourceGroup(sourceDetail);
  const reported = group !== 'other' && group !== 'unattributed';

  return { slug, confidence: reported ? 'reported' : 'inferred' };
}

/** The confidences a channel ranking may be built on without qualification. */
export const TRUSTED_ATTRIBUTION: readonly AttributionConfidence[] = ['reported'];

export function isReported(confidence: string | null | undefined): boolean {
  return confidence === 'reported';
}

/**
 * A deal's confidence, which is not a deal's own property.
 *
 * A deal has no source string of its own in this CRM. It inherits its channel from the
 * lead it was converted from, and 90% of deals were never converted from one — they were
 * opened straight on an account. So a deal's confidence is the lead's, one step weaker
 * where it was inherited, and `none` where there is no lead at all.
 *
 * Weakening on inheritance is the point. A deal whose channel came from a lead's
 * *inferred* channel is two guesses deep, and revenue attribution — the figure that
 * qualifies every channel ranking in the app at 10.2% — is exactly where that matters.
 */
export function inheritedConfidence(
  leadConfidence: AttributionConfidence | null | undefined,
): AttributionConfidence {
  if (leadConfidence === 'reported') return 'inferred';
  return 'none';
}
