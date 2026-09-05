import { isFreeEmailDomain, companyDomainFromEmail } from './dedupe.ts';
import { leadStatement, segmentOf, type LeadSegment } from './lead-segment.ts';
import type { AttributionConfidence } from './attribution-confidence.ts';

// §7.3: "a deterministic lead quality score: source tier + company domain present + phone
// present + segment match to the four ICPs + intent keyword in message. Computed in code;
// the model may explain it, never assign it."
//
// `Lead.score` has existed as a column since the first schema and is **0 on all 27,575
// rows**, which on screen reads as a score of zero rather than as no score. The manual's
// argument for filling it is that it lets the agent say "this campaign's leads got worse"
// three weeks before the conversion data would.
//
// Five components, each named and each worth stating separately — the point of a
// deterministic score is that somebody can disagree with one part of it. A single opaque
// 0-100 nobody can take apart is a model output wearing a formula's clothes.
//
// The model is not consulted. §20.1's principle is that the agent explains numbers and
// does not produce them, and a score it assigned would be unreproducible from the record.

export type ScoreInput = {
  channelSlug?: string | null;
  attributionConfidence?: AttributionConfidence | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  sourceDetail?: string | null;
  companyName?: string | null;
};

export type ScoreComponent = {
  key: string;
  label: string;
  points: number;
  max: number;
  /** Why this lead got these points. Rendered on the lead, so the score is arguable. */
  detail: string;
};

export type LeadScore = {
  /** 0-100. */
  total: number;
  components: ScoreComponent[];
  segment: LeadSegment | null;
  /**
   * Bumped whenever the weights or the rules change. Stored beside the score, because a
   * score compared across a change of formula is a comparison of two different questions
   * — exactly the failure the trend this score exists to serve would produce silently.
   */
  version: number;
};

export const SCORE_VERSION = 1;

/**
 * Channels ranked by what they have actually been worth here.
 *
 * Not a general truth about marketing — a fact about this account, and the reason the
 * tiers are written down rather than guessed. Referral and events convert; Meta lead
 * forms arrive in volume and mostly do not.
 *
 * 25 points, the largest single component, because source is the strongest predictor in
 * the data and because it is the one thing that is known about every lead.
 */
const SOURCE_TIER: Record<string, number> = {
  referral: 25,
  events: 22,
  'organic-search': 22,
  direct: 20,
  'landing-page': 18,
  email: 18,
  'google-ads': 15,
  linkedin: 12,
  incorp: 10,
  outreach: 10,
  whatsapp: 8,
  'meta-ads': 7,
  canada: 7,
  facebook: 6,
  instagram: 6,
};

/**
 * An unrecognised channel scores as the median tier, not as zero.
 *
 * A channel this file has not heard of is unknown, and unknown is not bad — scoring it
 * zero would rank every newly added source below the worst one ever measured, and
 * `Channel` is a table, so new slugs arrive without a deploy.
 */
const DEFAULT_TIER = 10;

/**
 * Phrases in the lead's own words that say when they intend to act.
 *
 * These are answers to a question the Meta lead form actually asks, not keywords guessed
 * at: "Immediately", "Within 30 days" and "Within 3 months" are the three options, and
 * they appear on 4,661 leads.
 *
 * First match wins, and the list is ordered strongest-first so a message saying both
 * "immediately" and "Delaware" scores the timeline rather than the state.
 */
const INTENT: { pattern: RegExp; points: number; detail: string }[] = [
  // No leading word boundary. The form concatenates its answers with no separator, so a
  // lead who chose "Immediately" produces "…under a US entityImmediately" — one word as
  // far as a regex is concerned, and `\bimmediately` matched none of them.
  { pattern: /immediately\b/i, points: 20, detail: 'Said they want to start immediately' },
  { pattern: /within 30 days|this month|urgent(ly)?|asap/i, points: 16, detail: 'Gave a timeline inside 30 days' },
  { pattern: /within 3 months|this quarter/i, points: 10, detail: 'Gave a timeline inside three months' },
  // Naming a state means they have got as far as choosing where to incorporate.
  { pattern: /delaware|wyoming|new york|california/i, points: 8, detail: 'Named the state they want to incorporate in' },
  {
    pattern: /new company incorporation|company registration|to serve us clients under a us entity|business expansion/i,
    points: 6,
    detail: 'Named what they want done',
  },
  // Explicitly the other way: the form's own "just looking" answer. Two points rather
  // than none, because saying so is still more than the 22,914 leads that said nothing.
  { pattern: /just exploring/i, points: 2, detail: 'Said they are only exploring for now' },
];

/**
 * Scores one lead.
 *
 * Pure: same record in, same number out, no clock and no database. That is what makes it
 * testable, and what makes today's score comparable to the score of a lead from April.
 */
export function scoreLead(input: ScoreInput): LeadScore {
  const components: ScoreComponent[] = [];

  // Source, 25.
  const slug = input.channelSlug ?? null;
  const tier = slug ? (SOURCE_TIER[slug] ?? DEFAULT_TIER) : 0;
  components.push({
    key: 'source',
    label: 'Source',
    points: tier,
    max: 25,
    detail: slug
      ? `Arrived through ${slug}${SOURCE_TIER[slug] === undefined ? ', which has no measured tier yet' : ''}`
      : 'Reached no channel, so there is nothing to rank',
  });

  // A company email, 20.
  //
  // A business domain is the cheapest signal that a company exists behind the lead.
  // 19,734 of this account's leads use gmail.com, so this component separates the small
  // minority who wrote from a company from the rest — which is the discrimination the
  // score exists to make.
  const domain = companyDomainFromEmail(input.email);
  const freeMail = Boolean(input.email) && !domain;
  components.push({
    key: 'domain',
    label: 'Company email',
    points: domain ? 20 : 0,
    max: 20,
    detail: domain
      ? `Wrote from ${domain}`
      : freeMail
        ? 'Wrote from a personal email provider'
        : 'No email address',
  });

  // Reachable, 10.
  //
  // 6,305 leads are marked "Not Reachable" in the CRM, so a number is not a formality
  // here. Weighted low because having one is not the same as answering it.
  const phone = input.phone?.trim();
  components.push({
    key: 'phone',
    label: 'Phone',
    points: phone ? 10 : 0,
    max: 10,
    detail: phone ? 'Gave a phone number' : 'No phone number',
  });

  // Segment, 25.
  const segment = segmentOf(input.message, input.sourceDetail);
  components.push({
    key: 'segment',
    label: 'Segment',
    points: segment ? 25 : 0,
    max: 25,
    detail: segment
      ? 'Described themselves as one of the target segments'
      : 'Did not say what kind of business they are',
  });

  // Intent, 20.
  //
  // Read from the lead's own words only. 694 leads carry the outbound broadcast that was
  // sent to them rather than anything they said, and that ad copy contains "company
  // registration" and every state name below — so scoring it would hand full intent marks
  // to leads for words the firm typed at them. See leadStatement.
  const said = leadStatement(input.message);
  const intent = said ? INTENT.find((i) => i.pattern.test(said)) : undefined;
  components.push({
    key: 'intent',
    label: 'Intent',
    points: intent?.points ?? 0,
    max: 20,
    detail: intent?.detail ?? 'Said nothing about what they want or when',
  });

  const total = components.reduce((sum, c) => sum + c.points, 0);

  return {
    // Clamped rather than trusted. The weights sum to 100 today; a component added later
    // without adjusting another must not produce a lead scoring 112.
    total: Math.max(0, Math.min(100, Math.round(total))),
    components,
    segment,
    version: SCORE_VERSION,
  };
}

/**
 * The bands the screens group by.
 *
 * Three, not five. A band is a decision about whether to ring somebody today, and there
 * are not five different versions of that decision.
 */
export function scoreBand(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 60) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

export { isFreeEmailDomain };
