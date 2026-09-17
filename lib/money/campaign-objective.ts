// G4: hiring advertising is not acquisition spend.
//
// This account runs recruitment campaigns out of the same ad account as its lead
// generation — `USAIndiaCFO_Hiring_VirtualCFO_Ajmer` and `UIC | Leads | Hiring | Virtual
// CFO Associate` between them carry ₹349,401 of lifetime spend. Every one of those rupees
// was in the denominator of CPL, CPQL, CAC and ROAS, which is a category error: money
// spent to hire a CFO did not buy a client, so dividing client acquisition by it makes
// acquisition look worse than it is, in a knowable direction.
//
// Measured over the dashboard's default window it was **₹67,108, or 15.6% of spend**.
//
// Deliberately not a filter applied at each call site. It is one column on Campaign,
// written by the sync, so the exclusion is a property of the campaign rather than
// something each of the four metrics has to remember — the way the four disagreed before.

/**
 * What the money was trying to buy.
 *
 * Four values, not Meta's twelve. The question every metric here asks is "is this
 * acquisition spend?", and a taxonomy finer than the question invites each caller to
 * re-collapse it differently.
 *
 * - `acquisition` — spend meant to produce leads or sales. The only kind CPL, CPQL, CAC
 *   and ROAS are entitled to divide by.
 * - `hiring` — recruitment advertising. Real money, not acquisition money.
 * - `awareness` — reach, video views, engagement. Excluded from cost-per-lead for the
 *   same reason: it was never asked to produce one.
 * - `other` — the provider said something this does not recognise. Counted as
 *   acquisition, because guessing a campaign is *not* acquisition silently shrinks the
 *   denominator and flatters every ratio. An unrecognised value should overstate cost,
 *   never understate it.
 */
export const CAMPAIGN_OBJECTIVES = ['acquisition', 'hiring', 'awareness', 'other'] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

/** The objectives whose spend is a cost of acquiring a customer. */
const ACQUISITION: readonly CampaignObjective[] = ['acquisition', 'other'];

export function isAcquisition(objective: string | null | undefined): boolean {
  return objective == null || ACQUISITION.includes(objective as CampaignObjective);
}

/**
 * Meta's special ad category for employment ads.
 *
 * This is the authoritative signal and the reason the resolver prefers it over the name:
 * an advertiser running a job ad is *required* by Meta to declare it, and the declaration
 * is structured data rather than a naming habit that can lapse.
 */
const EMPLOYMENT = 'EMPLOYMENT';

/**
 * Names that say the campaign is recruiting.
 *
 * The fallback, for the campaigns that predate the declaration or were never categorised.
 * Bounded rather than substring: `\bhiring\b` matches `_Hiring_` and `| Hiring |` (an
 * underscore is not a word character to this regex only because it is bounded on the
 * outside — so the pattern is written to tolerate both separators explicitly).
 *
 * `job` is absent on purpose. It is a substring of nothing useful here but a word that
 * turns up in agency campaign names meaning the client's job, and one false positive
 * removes real acquisition spend from the denominator — the failure direction this is
 * built to avoid.
 */
const HIRING_NAME = /(^|[^a-z])(hiring|recruit(ment|ing)?|vacanc(y|ies)|careers)([^a-z]|$)/i;

/** Meta objectives that are not asking anybody to become a lead. */
const AWARENESS_OBJECTIVES = new Set([
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'BRAND_AWARENESS',
  'REACH',
  'VIDEO_VIEWS',
  'POST_ENGAGEMENT',
  'PAGE_LIKES',
]);

/** Meta objectives that are. */
const ACQUISITION_OBJECTIVES = new Set([
  'OUTCOME_LEADS',
  'OUTCOME_SALES',
  'OUTCOME_TRAFFIC',
  'LEAD_GENERATION',
  'CONVERSIONS',
  'LINK_CLICKS',
  'MESSAGES',
  'OUTCOME_APP_PROMOTION',
]);

export type ObjectiveInput = {
  /** The platform's own objective string, verbatim. */
  platformObjective?: string | null;
  /** Meta's `special_ad_categories`, verbatim. */
  specialCategories?: readonly string[] | null;
  /** The campaign name, used only when neither of the above settles it. */
  name?: string | null;
};

/**
 * Classifies one campaign.
 *
 * Precedence is the declaration, then the name, then the objective.
 *
 * The name outranks the objective because a hiring campaign whose objective is
 * OUTCOME_LEADS is still hiring — it is generating leads, they are simply applicants.
 * Reading the objective first would classify every one of this account's recruitment
 * campaigns as acquisition, which is the bug.
 */
export function resolveObjective(input: ObjectiveInput): CampaignObjective {
  const categories = (input.specialCategories ?? []).map((c) => String(c).toUpperCase());
  if (categories.includes(EMPLOYMENT)) return 'hiring';

  if (input.name && HIRING_NAME.test(input.name)) return 'hiring';

  const objective = input.platformObjective?.trim().toUpperCase();
  if (objective) {
    if (AWARENESS_OBJECTIVES.has(objective)) return 'awareness';
    if (ACQUISITION_OBJECTIVES.has(objective)) return 'acquisition';
  }

  return 'other';
}

/**
 * The Prisma filter selecting campaigns whose spend belongs in an acquisition ratio.
 *
 * Null is included, and that is the whole safety property: a campaign nothing has
 * classified yet keeps counting exactly as it did before this column existed. Deploying
 * the column therefore cannot move a number on a screen — only the backfill and the sync
 * can, and both are deliberate acts.
 *
 * Exported as one object rather than repeated at four call sites because the four
 * disagreeing is the bug G4 describes.
 */
export const ACQUISITION_CAMPAIGN: {
  OR: ({ objective: null } | { objective: { in: string[] } })[];
} = {
  OR: [{ objective: null }, { objective: { in: [...ACQUISITION] } }],
};
