// The numbers the rules compare against: what each one is, and what it defaults to.
//
// Pure, and importable from a client component — the settings card renders every label,
// unit and hint from here. The reading and writing live in lib/settings.ts, for the
// reason lib/kpi.ts documents: a value import of a database-touching module from a client
// component follows the chain into the `pg` driver and breaks the build. It did, and
// /settings returned 500 until this was split.
//
// §20.5's closing line: "Thresholds live in a config table, editable by Shweta with the
// change recorded. They are never hard-coded and never decided by the model."
//
// Before this, every threshold in the application was a literal in source. One of them
// carried its own TODO noting it was currency-blind and worth about $10 against a rupee
// workspace — so it fired on trivial spend and nobody could move it without a deploy.
//
// ── Why the defaults are written down here and not hidden ─────────────────────────────
//
// A default is a judgement, and a judgement nobody can find is one nobody can argue
// with. Each carries its reasoning, and each is stated in the unit it is compared in —
// the currency-blind literal above is exactly what happens when a money threshold is
// written as a bare number.

/** Every threshold, its default, and what the number means. */
export const THRESHOLDS = {
  'attribution.threshold': {
    label: 'Minimum revenue attribution',
    unit: '%',
    default: 70,
    hint: 'Below this share of revenue reaching a channel, channel rankings are qualified rather than presented as a basis for moving budget.',
  },
  'pipeline.staleDays': {
    label: 'Deal goes stale after',
    unit: 'days',
    default: 30,
    hint: 'An open deal with no logged activity for this long. §20.5 names 30 or 60; 30 is the earlier warning.',
  },
  'leads.slaHours': {
    label: 'First-contact SLA',
    unit: 'hours',
    default: 48,
    hint: 'A new lead with no activity logged against it after this long is an SLA breach.',
  },
  'tasks.overdueFloor': {
    label: 'Task debt reported above',
    unit: 'tasks',
    default: 25,
    hint: 'How many overdue tasks one person may carry before it is worth raising. Below this it is a to-do list, not a finding.',
  },
  'sync.staleHours': {
    label: 'Sync considered stale after',
    unit: 'hours',
    default: 24,
    hint: '§20.5 names 24 hours. The nightly job runs once, so anything past this means a run was missed or failed.',
  },
  'seo.impressionFloor': {
    label: 'Page impressions floor',
    unit: 'impressions',
    default: 1000,
    hint: 'Below this a low click-through rate is noise rather than a missed opportunity.',
  },
  'seo.ctrFloor': {
    label: 'Page click-through floor',
    unit: '%',
    default: 1,
    hint: 'A page above the impressions floor whose click-through sits under this is a title and meta rewrite.',
  },
  'crm.renewalWindowDays': {
    label: 'Renewal window',
    unit: 'days',
    default: 60,
    hint: 'A retainer whose anniversary falls inside this window, with no open task against it, has nobody preparing the renewal touch.',
  },
  'crm.dormantCustomerDays': {
    label: 'Customer dormant after',
    unit: 'days',
    default: 90,
    hint: 'A customer won this long ago with no activity logged since — no review asked for, no referral, no contact.',
  },
  'marketing.pacingTolerance': {
    label: 'Budget pacing tolerance',
    unit: '%',
    default: 15,
    hint: '§20.5 says ±15% of plan month to date. Spend outside this band either side is off pace.',
  },
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;

export const THRESHOLD_KEYS = Object.keys(THRESHOLDS) as ThresholdKey[];

export type Thresholds = Record<ThresholdKey, number>;

export function isThresholdKey(key: unknown): key is ThresholdKey {
  return typeof key === 'string' && key in THRESHOLDS;
}

/**
 * Clamped and rounded, because every one of these arrives from a text field and ends up
 * in a comparison that decides whether a finding is raised.
 *
 * Negative is refused rather than clamped to zero for the same reason a percentage above
 * 100 is: both mean the person typing meant something else, and a silently corrected
 * threshold is a rule firing on a number nobody chose. A percentage is capped at 100; a
 * count or a duration has no natural ceiling and is only floored.
 */
export function parseThresholdValue(key: ThresholdKey, value: unknown): number {
  const spec = THRESHOLDS[key];
  const n =
    typeof value === 'number'
      ? value
      : Number((value as { value?: unknown })?.value ?? (value as { percent?: unknown })?.percent);
  if (!Number.isFinite(n) || n < 0) return spec.default;
  const rounded = Math.round(n);
  return spec.unit === '%' ? Math.min(100, rounded) : rounded;
}
