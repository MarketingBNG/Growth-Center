import { db } from './prisma.ts';
import { attributionSufficiency } from './attribution.ts';

// §21.2 "How to read a review card" and §21.3 "Decision rules — what to approve, return
// or escalate".
//
// The manual describes a card read in a fixed order and a table of decisions, and says of
// one of them: "this is the plan's own rule and the app enforces it." That sentence is
// the reason this file exists rather than a page of guidance — a rule the app enforces is
// a function, and a rule it merely describes is a poster.
//
// §20.4's pre-review — checking a statutory claim against the firm's verified figures —
// is genuinely blocked: there is no corpus to check against, and this file says so in the
// card rather than quietly leaving the section out. A review card missing its claims
// section reads as an asset with no claims in it, which is the one wrong answer.

export type Decision = 'approve' | 'return' | 'escalate' | 'hold';

export const DECISION_LABELS: Record<Decision, string> = {
  approve: 'Approve',
  return: 'Return',
  escalate: 'Escalate to the CA/CPA reviewer',
  hold: 'Hold',
};

export type CardSection = {
  /** §21.2's reading order, 1 to 5. Kept as a number because the order is the point: the
   *  first section can end the review, so nothing below it is worth reading yet. */
  order: number;
  title: string;
  /** What the reader is deciding at this step, in the manual's own words. */
  deciding: string;
  items: string[];
  /** True when this section on its own is a reason to refuse. §21.2: "If yes, return it —
   *  do not read further." */
  blocking: boolean;
  /** Set when the section cannot be filled because the material does not exist. Stated
   *  rather than omitted — an empty claims section reads as an asset with no claims. */
  unavailable?: string;
};

export type ReviewCard = {
  subject: string;
  sections: CardSection[];
  /** What the rules say, before the reader forms their own view. Never applied
   *  automatically: §20.1's third principle is that the agent proposes and Shweta
   *  disposes, so this is a recommendation with its reasons attached. */
  recommendation: Decision;
  reasons: string[];
};

/**
 * §21.4's list, as predicates rather than prose.
 *
 * "What must never be approved." Each one refuses, and each says which clause refused it —
 * a refusal whose grounds are not quotable is one somebody overrides.
 */
export type Refusal = { clause: string; reason: string };

export type AssetUnderReview = {
  subject: string;
  /** Body text, for the placeholder and figure checks. */
  text?: string | null;
  /** The channel a scale or stop proposal concerns, where it concerns one. */
  channelSlug?: string | null;
  /** 'scale' | 'stop' | null. The two proposals §21.3 has explicit rules for. */
  proposal?: 'scale' | 'stop' | null;
  /** Days of clean data behind a stop proposal. */
  cleanDataDays?: number | null;
  /** Whether a figure in the text is traceable to a verified source. Null means nobody
   *  has checked, which is not the same as false and is treated as unverified. */
  figuresGrounded?: boolean | null;
  /** True when the asset goes out in a named partner's voice. */
  partnerVoice?: string | null;
  partnerApprovedAt?: Date | null;
  /** Whether a cold sequence's list has passed the suppression check. */
  suppressionChecked?: boolean | null;
};

/**
 * An unresolved token, an empty subject, or a bracketed placeholder. §21.4's second item.
 *
 * Deliberately the same shapes lib/outreach-lint.ts already refuses, because a placeholder
 * that passes one gate and fails the other is a gate somebody learns to route around.
 */
const PLACEHOLDER = /\{\{[^}]*\}\}|\[[A-Z][A-Za-z ]{2,}\]|\bTBD\b|\bXXX+\b|\bLorem ipsum\b/;

/** Money, percentages, dates and penalties — the figures §21.4 will not take on trust. */
const FIGURE = /(₹|\$|USD|INR)\s?[\d,]+|\b\d+(\.\d+)?%|\bpenalty\b|\bdeadline\b|\bdue by\b/i;

/**
 * Everything §21.4 forbids, checked in its own order.
 *
 * Returns every refusal rather than the first. A reader sent back three times over three
 * separate faults learns that the gate is arbitrary; sent back once with three reasons,
 * they fix all of them.
 */
export function refusals(asset: AssetUnderReview): Refusal[] {
  const found: Refusal[] = [];
  const text = asset.text ?? '';

  if (!asset.subject.trim()) {
    found.push({ clause: '§21.4', reason: 'The subject is empty.' });
  }
  if (PLACEHOLDER.test(text) || PLACEHOLDER.test(asset.subject)) {
    found.push({
      clause: '§21.4',
      reason: 'There is an unresolved token or a bracketed placeholder in the text.',
    });
  }
  // `false`, not `!== true`, and the distinction is the difference between two of §21.3's
  // rows. A figure somebody checked and could not ground is a refusal; a figure nobody has
  // checked yet escalates to the CA/CPA reviewer, which is a different instruction to a
  // different person. Written as `!== true` first, this refused both and made the escalate
  // path in `decide` unreachable — the reviewer would never have been asked.
  if (FIGURE.test(text) && asset.figuresGrounded === false) {
    found.push({
      clause: '§21.4',
      reason:
        'It states a figure — a penalty, threshold, deadline or rate — that somebody checked and could not trace to a verified source. Not from the agent, not from a template, not because it was in last year’s email.',
    });
  }
  if (asset.partnerVoice && !asset.partnerApprovedAt) {
    found.push({
      clause: '§21.4',
      reason: `It goes out in ${asset.partnerVoice}’s name and ${asset.partnerVoice} has not approved it.`,
    });
  }
  if (asset.suppressionChecked === false) {
    found.push({
      clause: '§21.4',
      reason:
        'The prospect list has not passed the suppression check against clients and referral partners.',
    });
  }
  return found;
}

/**
 * §21.3's decision table, over one asset.
 *
 * The scale rule is the one the manual singles out as enforced rather than advised: "A
 * scale proposal on a channel whose attribution health is below threshold — Return. Fix
 * the data first." This workspace's revenue attribution is 10.2% against a threshold of
 * 70%, so today that rule refuses every scale proposal there is, which is the correct and
 * uncomfortable answer.
 */
export async function decide(asset: AssetUnderReview): Promise<{ decision: Decision; reasons: string[] }> {
  const reasons: string[] = [];

  // §21.2's first section can end the review on its own, so the refusals are asked first.
  const blocked = refusals(asset);
  if (blocked.length > 0) {
    return { decision: 'return', reasons: blocked.map((r) => `${r.clause}: ${r.reason}`) };
  }

  // "The same figure with no citation, or a citation she does not recognise — escalate to
  // the CA/CPA reviewer. Never approve on the agent's confidence alone."
  // Undefined as well as null: an asset that never carried the field has not been checked
  // either, and treating "the caller did not say" as "verified" would approve on silence.
  if (FIGURE.test(asset.text ?? '') && asset.figuresGrounded !== true) {
    return {
      decision: 'escalate',
      reasons: [
        '§21.3: it carries a regulatory figure that nobody has checked against a source. Never approved on the agent’s confidence alone.',
      ],
    };
  }

  if (asset.proposal === 'scale') {
    const scale = await canScale();
    if (!scale.allowed) return { decision: 'return', reasons: [scale.reason] };
    reasons.push(scale.reason);
  }

  // "A stop proposal on a channel with fewer than 14 days of clean data — hold, and ask
  // for the fortnight."
  if (asset.proposal === 'stop') {
    const days = asset.cleanDataDays ?? 0;
    if (days < 14) {
      return {
        decision: 'hold',
        reasons: [
          `§21.3: ${days} days of clean data behind a stop proposal. Hold, and ask for the fortnight — stopping a channel on a week of numbers is a decision made on noise.`,
        ],
      };
    }
    reasons.push(`${days} days of clean data behind the proposal.`);
  }

  // "A partner-name post — approve for brand and technical content, then route to that
  // partner for their own sign-off." The refusal above already caught the unapproved
  // case, so reaching here means the partner has signed.
  if (asset.partnerVoice) {
    reasons.push(`${asset.partnerVoice} has signed this off in their own name.`);
  }

  if (reasons.length === 0) reasons.push('Nothing in §21.4 refuses it and no decision rule applies.');
  return { decision: 'approve', reasons };
}

/**
 * The card itself, in §21.2's reading order.
 *
 * Sections two and four are the ones that depend on material the firm does not have. They
 * are rendered as unavailable rather than dropped, because a card with no claims section
 * reads as an asset making no claims — and that is precisely the reading the section
 * exists to prevent.
 */
export async function reviewCard(asset: AssetUnderReview): Promise<ReviewCard> {
  const blocked = refusals(asset);
  const { decision, reasons } = await decide(asset);

  const sections: CardSection[] = [
    {
      order: 1,
      title: 'Critical findings',
      deciding:
        'Is there anything here that must not go out? If yes, return it — do not read further.',
      items: blocked.map((r) => r.reason),
      blocking: true,
    },
    {
      order: 2,
      title: 'Claims and grounding',
      deciding:
        'Each tax or regulatory statement, with the corpus citation beside it. Anything ungrounded goes to the CA/CPA reviewer before it comes back, not after.',
      items: [],
      blocking: true,
      // The one section of this manual that cannot be started rather than merely
      // deferred. Checking a statutory claim requires the firm's own verified figures to
      // check it against, and there are none.
      unavailable:
        'There is no verified corpus to cite against. Until there is, any regulatory figure in this asset escalates rather than being checked here — which is what the decision above does.',
    },
    {
      order: 3,
      title: 'What the agent was unsure about',
      deciding: 'Whether the uncertainty changes the decision.',
      items:
        asset.figuresGrounded !== true && FIGURE.test(asset.text ?? '')
          ? ['A regulatory figure appears in the text and nothing has verified it.']
          : [],
      blocking: false,
    },
    {
      order: 4,
      title: 'The decision rules that apply',
      deciding: 'What §21.3 says about this asset before you form your own view.',
      items: reasons,
      blocking: false,
    },
    {
      order: 5,
      title: 'Provenance',
      deciding: 'Where this came from, so the approval records what was actually seen.',
      items: [
        asset.channelSlug ? `Channel: ${asset.channelSlug}` : 'No channel attached.',
        asset.proposal ? `Proposal: ${asset.proposal}` : 'Not a budget proposal.',
        asset.partnerVoice ? `Partner voice: ${asset.partnerVoice}` : 'Written in the firm’s own voice.',
      ],
      blocking: false,
    },
  ];

  return { subject: asset.subject, sections, recommendation: decision, reasons };
}

/**
 * Whether a scale proposal may be approved at all right now.
 *
 * Exported on its own because §21.4's last two items — "any scale decision on a channel
 * that has not met the attribution-health threshold" and "any campaign without a registry
 * row naming its objective, segment, service line and landing page" — are conditions the
 * budget screens need to check before offering the button, not only after it is pressed.
 */
export async function canScale(now = new Date()): Promise<{ allowed: boolean; reason: string }> {
  // `attributionSufficiency` owns the window, and the coverage rule asks it the same
  // question. D11 was this panel reporting 10.1% while the coverage insight beside it
  // reported 7.27% — one idea, two numbers, because each measured its own period off the
  // same arithmetic. Neither caller chooses a window any more.
  const health = await attributionSufficiency(now);
  const floor = health.threshold;
  const percent = health.revenue.percent;

  // Null is not a pass. A period with no revenue in it has not met an attribution
  // standard; it has provided nothing to measure, and a scale decision justified by
  // nothing is exactly what §21.4 forbids.
  if (percent === null) {
    return {
      allowed: false,
      reason: 'There is no revenue in the period to attribute, so no scale decision can be justified by it.',
    };
  }
  if (percent < floor) {
    return {
      allowed: false,
      reason: `§21.4: revenue attribution is ${percent.toFixed(1)}% against a ${floor}% threshold, so no scale decision may rest on the channel ranking. Fix the data first — the ranking that would justify the scale is drawn from a tenth of the money.`,
    };
  }
  return { allowed: true, reason: `Revenue attribution is ${percent.toFixed(1)}%, above the ${floor}% threshold.` };
}

/**
 * §21.4's last clause, over the campaign registry.
 *
 * "Any campaign without a registry row naming its objective, segment, service line and
 * landing page." Three of those four columns now exist — objective and landing page on
 * Campaign, segment on Lead and Company — so this can finally be checked rather than
 * described.
 */
export async function campaignsMissingRegistry() {
  const rows = await db().campaign.findMany({
    where: {
      OR: [{ objective: null }, { landingPage: null }],
      // Only campaigns that are actually running. A paused campaign from last November
      // with no landing page recorded is history, not a decision anybody is about to take.
      status: 'active',
    },
    select: { id: true, name: true, objective: true, landingPage: true },
    orderBy: { name: 'asc' },
  });

  return rows.map((c) => ({
    ...c,
    missing: [c.objective ? null : 'objective', c.landingPage ? null : 'landing page'].filter(
      (m): m is string => m !== null,
    ),
  }));
}
