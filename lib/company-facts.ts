// §8.4: "On the company record add Segment, Entity type and Jurisdictions."
//
// "These are the dual-jurisdiction facts the delivery team already knows and marketing
// cannot target without." That is the whole justification, and it also says why nothing
// here is imported or inferred: the knowledge is in the delivery team's heads, not in
// Zoho, so there is no source to read and any guess would be marketing acting on
// something nobody checked.
//
// The manual's own "done when" is the top hundred accounts, not all 2,953.

/**
 * The company's segment, shared with the lead-side vocabulary.
 *
 * Deliberately the same five values as lib/lead-segment.ts. A lead that becomes a company
 * should not change segment on the way through, and two vocabularies for one word is how
 * the marketing report and the client list come to disagree about what the firm sells.
 */
export { LEAD_SEGMENTS as COMPANY_SEGMENTS, SEGMENT_LABELS as COMPANY_SEGMENT_LABELS } from './lead-segment.ts';

/** §8.4's four, verbatim. */
export const ENTITY_TYPES = ['llc', 'c_corp', 'indian_pvt_ltd', 'individual'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  llc: 'LLC',
  c_corp: 'C-Corp',
  indian_pvt_ltd: 'Indian Pvt Ltd',
  individual: 'Individual',
};

/**
 * Where an account has obligations. §8.4 names "US federal, states, India, UAE".
 *
 * "States" is left as one value rather than exploded into fifty. The firm's compliance
 * work is federal plus whichever state the entity was formed in, and the state itself is
 * already recorded on the deal — a fifty-item picker here would be a second place to get
 * it wrong.
 */
export const JURISDICTIONS = ['us_federal', 'us_state', 'india', 'uae'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  us_federal: 'US federal',
  us_state: 'US state',
  india: 'India',
  uae: 'UAE',
};

export const isEntityType = (v: unknown): v is EntityType =>
  typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v);

export const isJurisdiction = (v: unknown): v is Jurisdiction =>
  typeof v === 'string' && (JURISDICTIONS as readonly string[]).includes(v);

export const entityTypeLabel = (v: string | null | undefined) =>
  isEntityType(v) ? ENTITY_TYPE_LABELS[v] : '—';

export const jurisdictionLabels = (values: string[]) =>
  values.filter(isJurisdiction).map((j) => JURISDICTION_LABELS[j]);

/**
 * Whether a jurisdiction set is internally coherent.
 *
 * `us_state` without `us_federal` is the one combination that is always wrong: a US state
 * filing implies a federal one, and an account recorded as state-only would drop out of
 * every federal compliance list while looking complete on screen. Reported rather than
 * corrected — silently adding a jurisdiction nobody entered is how a record stops being
 * a record of what somebody said.
 */
export function jurisdictionWarning(values: string[]): string | null {
  const set = new Set(values);
  if (set.has('us_state') && !set.has('us_federal')) {
    return 'A US state filing implies a federal one. This account will be missing from federal compliance lists.';
  }
  return null;
}
