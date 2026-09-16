
/**
 * Which desk each rule's findings belong on, and who is sitting at it.
 *
 * ── D7 ────────────────────────────────────────────────────────────────────────────────
 *
 * "Insights carry an owner only for task and lead items; the rest are unowned." Four of
 * the sixteen rules name somebody, and they are the four whose data already contains a
 * person — the lead's owner, the assignee of an overdue task. The other twelve produce
 * findings that land in a queue belonging to nobody, and §5.2's answer is a map from
 * insight domain to the person who executes it.
 *
 * ── Why this is a role map and not an address book ────────────────────────────────────
 *
 * The manual's map names Gaurav, Krati, Dakshita, Islam and Riyaz. None of them holds an
 * account in this workspace or owns a record in the CRM — the schema note on
 * `AiInsight.ownerEmail` says so, and it is why the field was left null rather than
 * filled in from the manual. Writing those names into code produces a mapping that
 * resolves to nobody and looks, on the page, exactly like a mapping that works.
 *
 * So the code owns the half that is a fact about the rules — paid-media findings belong
 * to whoever runs paid media — and a stored setting owns the half that is a fact about
 * the team. The binding is empty until somebody fills it in, and an unbound domain raises
 * a configuration finding rather than leaving a queue item unowned, which is §5.2's own
 * rule: "an insight with no owner in this map is a configuration error, shown to Abhuday
 * as such, and never left sitting unowned in a queue."
 *
 * Pure, and importable from a client component — the Settings card renders every desk
 * from here. `ownerBindings` reads the stored half and lives in lib/settings.ts, for the
 * reason lib/insight-lifecycle.ts is kept apart from lib/insight-actions.ts: a value
 * import of a database-touching module from a client component follows the chain into the
 * `pg` driver and breaks the build.
 */

/** The desks in §5.2, as the rules divide them. */
export const OWNER_DOMAINS = {
  paid: 'Paid campaigns, pacing, spend and creative performance',
  outbound: 'Outbound deliverability, templates and list hygiene',
  attribution: 'Lead-source hygiene and channel coverage',
  seo: 'SEO, click-through, technical issues and AI citations',
  social: 'Social cadence, engagement and the inbox',
  crm: 'CRM routing, duplicates, lost reasons and lead quality',
  lifecycle: 'Renewals, dormant customers, referrals and reviews',
  web: 'Website, analytics, sync health and reconciliation',
} as const;

export type OwnerDomain = keyof typeof OWNER_DOMAINS;

/**
 * Rule → desk.
 *
 * A fact about what the rule measures, so it lives in code rather than in a setting.
 * Rules that name their own owner from the data are absent deliberately: the lead's owner
 * is a better answer than the desk's, and overwriting it with a role would send an SLA
 * breach to a manager instead of to the person holding the lead.
 */
export const RULE_DOMAIN: Record<string, OwnerDomain> = {
  attribution_health_below_threshold: 'attribution',
  spend_off_pace: 'paid',
  spend_over_envelope: 'paid',
  lead_quality_below_floor: 'paid',
  template_placeholder: 'outbound',
  suppression_breach: 'outbound',
  high_impression_low_ctr_page: 'seo',
  seo_technical_issue_widespread: 'seo',
  lost_reason_concentration: 'crm',
  duplicate_backlog: 'crm',
  renewal_without_task: 'lifecycle',
  review_or_referral_not_requested: 'lifecycle',
  referral_partner_silent: 'lifecycle',
  sync_stale_or_failed: 'web',
  // stale_deals, lead_sla_breach and task_debt name a person from their own data.
};

export const OWNERS_KEY = 'marketing.owners';

export type OwnerBindings = Partial<Record<OwnerDomain, string>>;

/**
 * The owner a rule's findings should carry, or null.
 *
 * Null covers two different situations on purpose — a rule with no desk, and a desk with
 * nobody at it — and the caller reports the second as a configuration gap. Returning an
 * address for either would be inventing one.
 */
export function ownerFor(ruleId: string, bindings: OwnerBindings): string | null {
  const domain = RULE_DOMAIN[ruleId];
  if (!domain) return null;
  return bindings[domain] ?? null;
}

/** Desks that some rule routes to and nobody is sitting at. The configuration gap. */
export function unboundDomains(bindings: OwnerBindings): OwnerDomain[] {
  const routed = new Set(Object.values(RULE_DOMAIN));
  return [...routed].filter((d) => !bindings[d]).sort();
}
