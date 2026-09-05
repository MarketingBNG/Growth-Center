// §9.5: "Probability by stage plus deterministic age decay. Weighted pipeline should fall
// when a deal goes quiet. Today it does not move at all."
//
// The complaint is exact. `Opportunity.probability` is set from the stage when the deal is
// created and never changes again, so the weighted figure is a stage count wearing a
// forecast's clothes: 966 open deals hold two distinct probabilities between them, and a
// deal untouched since November weighs exactly what it did the day it was opened.
//
// Deterministic, and that word is doing work. This is not a model and not a fitted curve
// — it is one published rule anybody can apply on paper to a deal in front of them and
// get the same answer. §20.1's principle again: the system computes, the model explains.

/**
 * How long a deal may sit before its odds start falling.
 *
 * Matches `pipeline.staleDays`, which is what the stale-deal rule already fires on. Two
 * numbers would mean a deal could be flagged as stale while still weighing full value, or
 * lose value while nothing said why — and the second is worse, because a forecast that
 * moves for unstated reasons is one nobody trusts.
 */
export const DECAY_GRACE_DAYS = 30;

/**
 * The floor a decayed probability cannot fall through.
 *
 * Not zero. A deal at zero is lost, and this rule has no authority to say so — that is
 * §9.3's job and it requires a person to confirm. Decaying to nothing would let a silent
 * deal disappear from the forecast without anybody deciding it was dead, which is exactly
 * the quiet write-off the stale-deal rule exists to prevent.
 */
export const DECAY_FLOOR = 0.2;

/**
 * Half-life in days: how long silence takes to halve a deal's odds.
 *
 * Ninety days, against an average cycle of sixty-nine. A deal that has been quiet for
 * longer than the whole cycle usually takes is worth appreciably less than half, and the
 * curve gets there at roughly a hundred and thirty days — late enough not to punish a
 * fortnight's holiday, early enough that a quarter of silence shows.
 */
export const DECAY_HALF_LIFE_DAYS = 90;

const DAY = 86_400_000;

/**
 * The multiplier applied to a deal's stage probability, between DECAY_FLOOR and 1.
 *
 * Exponential rather than linear. A linear decline has a cliff at whatever day it reaches
 * zero, and every deal on one side of that day is worth nothing while the deal a day
 * younger is worth something — a discontinuity in a forecast that a person will notice
 * and stop believing. An exponential curve has no cliff and no edge case.
 */
export function decayFactor(daysSinceActivity: number): number {
  const idle = daysSinceActivity - DECAY_GRACE_DAYS;
  if (idle <= 0) return 1;
  const factor = Math.pow(0.5, idle / DECAY_HALF_LIFE_DAYS);
  return Math.max(DECAY_FLOOR, factor);
}

export type DecayInput = {
  /** The stage's probability, 0-100. */
  probability: number;
  /** The last thing that happened on the deal — an activity, or the deal's own update. */
  lastActivityAt: Date | null;
  createdAt: Date;
};

export type Decayed = {
  /** What the stage says, unchanged. Kept so the page can show both. */
  stageProbability: number;
  /** What it is worth after silence, 0-100. */
  probability: number;
  daysIdle: number;
  factor: number;
};

/**
 * Decays one deal.
 *
 * Measured from the last activity, or from creation where there has never been one. A
 * deal opened four months ago with nothing ever logged against it is the clearest case
 * this rule exists for, and measuring from a null would have exempted it.
 */
export function decay(deal: DecayInput, now: Date): Decayed {
  const since = deal.lastActivityAt ?? deal.createdAt;
  const daysIdle = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY));
  const factor = decayFactor(daysIdle);

  return {
    stageProbability: deal.probability,
    // Rounded, because a probability is shown as a whole percent and a forecast that
    // reconciles to the screen has to be computed from what the screen says.
    probability: Math.round(deal.probability * factor),
    daysIdle,
    factor,
  };
}

/**
 * A sentence explaining a decayed deal, for the row that shows it.
 *
 * The rule is published rather than hidden behind the number. A forecast that falls for
 * reasons nobody can state is a forecast people work around, and the whole argument for a
 * deterministic decay over a model is that it can be explained in one line.
 */
export function explainDecay(d: Decayed): string | null {
  if (d.factor >= 1) return null;
  return `Quiet for ${d.daysIdle} days, so ${d.stageProbability}% is counted as ${d.probability}%. Odds halve every ${DECAY_HALF_LIFE_DAYS} days of silence after the first ${DECAY_GRACE_DAYS}, and never fall below ${Math.round(DECAY_FLOOR * 100)}% of the stage figure.`;
}
