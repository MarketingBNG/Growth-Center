import { db } from './prisma.ts';
import type { Thresholds } from './thresholds.ts';
import { thresholds } from './settings.ts';
import { attributionHealth } from './attribution.ts';
import { lintSequence, summarise } from './outreach-lint.ts';
import { envelopesFor, quarterOf } from './budget.ts';
import { rate } from './calc.ts';
import type { InsightKind } from './enums.ts';

// The rule library. §20.5, first release.
//
// §20.1's first principle: "Every insight originates in a deterministic rule over the
// metrics table — a threshold, a trend, an anomaly, an SLA breach, a data-quality
// failure. The model narrates, prioritises and proposes; it never computes a number, sets
// a date, or decides whether something applies."
//
// So a rule here does all the deciding. It queries, compares against a stored threshold,
// and returns its figures as `evidence`. The model is handed the evidence afterwards and
// asked for sentences — see generateInsights in lib/ai.ts. Nothing in this file calls a
// model, and nothing here is reachable from one.
//
// ── Which of the manual's 25 are here, and why the rest are not ───────────────────────
//
// Ten. The other fifteen are not "not yet built": each is missing something this
// workspace does not have, and writing them anyway would produce rules that either never
// fire or fire on a figure that does not mean what the rule thinks.
//
//   No field exists for it:
//     CPQL over/under target      `qualifiedAt` means converted here; Zoho Bookings is
//                                 not integrated, so the numerator has no signal at all.
//     Lead quality drop           There is no quality score on Lead.
//     Lost-reason concentration   Lead carries no lost reason. Opportunity does, on 42
//                                 rows of 175 lost deals.
//     Commercial keyword drop     Rankings are stored; nothing marks a term commercial.
//     AI citation lost            No tracked-question table.
//     Suppression breach          Is_Client / Is_Referral_Partner are not in the Zoho
//                                 Contacts field list, so the flags cannot be read.
//
//   The table is empty, so the rule would be a rule about nothing:
//     Deliverability threshold    outreach_message holds 0 rows.
//     Reply unassigned            Same table.
//     Approval pending beyond 48h content_piece holds 0 rows.
//     Profile below cadence       0 social posts in the last 14 days.
//
//   Blocked outside the code:
//     New technical issue         Semrush subscription has no API units (commit caa98fe).
//     Tax claim unverified        Needs the controlled corpus, which does not exist.
//     Reconciliation variance     Nothing records what the vendor said the count was.
//     Campaign with zero leads    campaignId is null on all 27,458 leads, so a
//                                 per-campaign lead count is structurally uncomputable.
//                                 Reported per channel instead, where the data is real.
//
// That leaves the ten below. Each was checked against the live database before it was
// written, which is how the notes above are so specific.

export type RuleSection =
  | 'dashboard'
  | 'leads'
  | 'crm'
  | 'pipeline'
  | 'marketing'
  | 'seo'
  | 'ads'
  | 'social'
  | 'outreach'
  | 'content'
  | 'analytics'
  | 'tasks';

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'info';

/** What a rule returns when it fires. No prose: the model writes that from `evidence`. */
export type Finding = {
  /** Stable within a rule, so one rule may raise several distinct findings — task debt
   *  names the person, and each person's debt is its own finding with its own owner. */
  subject: string;
  evidence: Record<string, unknown>;
  /** The step to take. Written by the rule, not the model: §20.1 lets the model *propose*
   *  from a rule template, and a template that names the action leaves nothing to invent. */
  proposedAction: string;
  /** Overrides the rule's own severity where the same rule spans two bands — a deal 60
   *  days stale is not the same finding as one at 30. */
  severity?: RuleSeverity;
  /** Suggested owner, where the data names one. Null where it does not; the manual's
   *  role map names six people who hold no account here and own no records. */
  ownerEmail?: string | null;
};

export type Rule = {
  id: string;
  /** Bumped when the rule's logic changes, so an old finding can be told apart from what
   *  the current rule would say. Part of Appendix B for exactly that reason. */
  version: number;
  section: RuleSection;
  severity: RuleSeverity;
  kind: InsightKind;
  /** One line saying what the rule tests, shown next to the finding and handed to the
   *  model as the frame for its narration. */
  test: string;
  /**
   * Whether the rule measures a period's activity or a condition that holds right now.
   *
   * Declared rather than inferred, because the two are not distinguishable by reading a
   * rule's query and the difference decides whether firing is correct. An overdue task is
   * overdue whatever range the dashboard is showing; revenue attribution for Q1 is a
   * statement about Q1. Seven of these eleven turned out to be standing rules, which was
   * not obvious to anybody — including to me, until the eval suite asked the question by
   * running every rule over a window in 1990 and eight of them fired.
   *
   * `standing` is a claim, and the claim is that firing on any window is correct.
   */
  scope: 'period' | 'standing';
  run: (ctx: RuleContext) => Promise<Finding[]>;
};

export type RuleContext = {
  from: Date;
  to: Date;
  now: Date;
  thresholds: Thresholds;
  currency: string;
};

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000);
const daysAgo = (now: Date, days: number) => hoursAgo(now, days * 24);

// ── The rules ─────────────────────────────────────────────────────────────────────────

const attributionRule: Rule = {
  id: 'attribution_health_below_threshold',
  scope: 'period',
  version: 1,
  section: 'dashboard',
  severity: 'high',
  kind: 'risk',
  test: 'Share of revenue that reaches a channel, against the workspace threshold',
  async run(ctx) {
    const health = await attributionHealth(ctx.from, ctx.to);
    if (health.sufficient !== false) return [];
    return [
      {
        subject: 'attribution-health-below-threshold',
        // Key names carry their own meaning here, because the model reads nothing else.
        // Called `revenueAttributedPercent` it wrote "the channel is associated with
        // 7.38% of revenue" — reading a workspace-wide coverage figure as one channel's
        // share. Naming the subject in the key fixed the sentence.
        evidence: {
          revenueReachingAnyChannelPercent: round(health.revenue.percent),
          revenueReachingAnyChannel: Math.round(health.revenue.covered),
          revenueTotal: Math.round(health.revenue.total),
          dealsWithAnyChannelPercent: round(health.deals.percent),
          leadsWithAnyChannelPercent: round(health.leads.percent),
          thresholdPercent: health.threshold,
          currency: health.currency,
          basis: 'coverage across the whole workspace, not one channel',
        },
        proposedAction:
          'Set Lead_Source on the deal record at close, so revenue inherits a channel instead of only the lead that never existed.',
      },
    ];
  },
};

const staleDealsRule: Rule = {
  id: 'stale_deals',
  scope: 'standing',
  version: 1,
  section: 'pipeline',
  severity: 'medium',
  kind: 'risk',
  test: 'Open deals with no activity logged for longer than the stale threshold',
  async run(ctx) {
    const cutoff = daysAgo(ctx.now, ctx.thresholds['pipeline.staleDays']);

    const open = await db().opportunity.findMany({
      where: { stage: { is: { isWon: false, isLost: false } } },
      select: {
        id: true,
        ownerEmail: true,
        activities: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (open.length === 0) return [];

    const stale = open.filter((d) => {
      const last = d.activities[0]?.createdAt;
      return !last || last < cutoff;
    });
    if (stale.length === 0) return [];

    // Reported as one finding about the pipeline, not one per deal.
    //
    // 965 of the 966 open deals here have no activity ever logged against them, because
    // only 1,724 of 29,400 activity rows carry an opportunityId at all. Raised per deal
    // this would be 965 identical items nobody could work through, and every one of them
    // would blame the deal for a gap in how activity is recorded. The share is the
    // finding.
    const share = rate(stale.length, open.length);

    return [
      {
        subject: 'stale-open-deals',
        evidence: {
          openDeals: open.length,
          staleDeals: stale.length,
          stalePercent: round(share),
          basis: 'stalePercent is a share of open deals, not of all deals',
          staleAfterDays: ctx.thresholds['pipeline.staleDays'],
          dealsWithAnyActivityLogged: open.filter((d) => d.activities.length > 0).length,
        },
        severity: share !== null && share > 90 ? 'high' : 'medium',
        proposedAction:
          'Check whether deal activity is syncing from Zoho at all before chasing owners — almost no open deal has any logged.',
      },
    ];
  },
};

const leadSlaRule: Rule = {
  id: 'lead_sla_breach',
  scope: 'period',
  version: 1,
  section: 'leads',
  severity: 'high',
  kind: 'risk',
  test: 'New leads with nothing logged against them past the first-contact SLA',
  async run(ctx) {
    const sla = ctx.thresholds['leads.slaHours'];
    // Whichever comes first: the SLA cutoff, or the end of the window being reported on.
    // It was the cutoff alone, which is right for a window ending today and wrong for any
    // other — a report about January would have counted a lead that arrived last week,
    // because `gte: ctx.from` with an upper bound of two days ago spans everything
    // between. Found by the eval suite running every rule over a window in 1990.
    const slaCutoff = hoursAgo(ctx.now, sla);
    const cutoff = slaCutoff < ctx.to ? slaCutoff : ctx.to;

    // Only leads old enough to have breached. A lead created an hour ago with no activity
    // is not late, and counting it would make the figure a measure of intake rather than
    // of response.
    const breached = await db().lead.groupBy({
      by: ['ownerEmail'],
      where: {
        createdAt: { gte: ctx.from, lt: cutoff },
        status: 'new',
        activities: { none: {} },
      },
      _count: { _all: true },
    });
    if (breached.length === 0) return [];

    const total = breached.reduce((n, r) => n + r._count._all, 0);
    const worst = [...breached].sort((a, b) => b._count._all - a._count._all)[0];

    return [
      {
        subject: 'leads-untouched-past-sla',
        evidence: {
          untouchedLeads: total,
          slaHours: sla,
          owners: breached.length,
          largestHolder: worst.ownerEmail,
          largestHolderLeads: worst._count._all,
        },
        ownerEmail: worst.ownerEmail,
        proposedAction:
          'Rebalance the untouched leads off the largest holder using the Leads page Rebalance action.',
      },
    ];
  },
};

const taskDebtRule: Rule = {
  id: 'task_debt',
  scope: 'standing',
  version: 1,
  section: 'tasks',
  severity: 'medium',
  kind: 'risk',
  test: 'Overdue tasks per owner, against the debt floor',
  async run(ctx) {
    const floor = ctx.thresholds['tasks.overdueFloor'];

    const overdue = await db().task.groupBy({
      by: ['assigneeEmail'],
      where: { dueDate: { lt: ctx.now }, status: { in: ['open', 'in_progress'] } },
      _count: { _all: true },
    });

    // One finding per person, because the action is per person and each needs its own
    // owner. The floor is what keeps this from raising a finding for everybody with a
    // couple of late items.
    return overdue
      .filter((r) => r._count._all >= floor && r.assigneeEmail)
      .sort((a, b) => b._count._all - a._count._all)
      .map((r) => ({
        subject: `task-debt-${slug(r.assigneeEmail!)}`,
        evidence: {
          assignee: r.assigneeEmail,
          overdueTasks: r._count._all,
          floor,
        },
        ownerEmail: r.assigneeEmail,
        proposedAction: 'Close, reschedule or reassign the overdue tasks on this person.',
      }));
  },
};

const syncStaleRule: Rule = {
  id: 'sync_stale_or_failed',
  scope: 'standing',
  version: 1,
  section: 'analytics',
  severity: 'high',
  kind: 'risk',
  test: 'Connected integrations that have not synced inside the stale window, or errored',
  async run(ctx) {
    const stale = hoursAgo(ctx.now, ctx.thresholds['sync.staleHours']);

    const live = await db().integration.findMany({
      where: { state: { in: ['connected', 'syncing', 'error'] } },
      select: { provider: true, state: true, lastSyncAt: true, lastError: true, lastErrorAt: true },
    });

    const broken = live.filter(
      (i) => i.state === 'error' || i.lastError !== null || !i.lastSyncAt || i.lastSyncAt < stale,
    );
    if (broken.length === 0) return [];

    // Per provider: each is a different system with a different person to talk to, and
    // "three integrations are stale" is not something anyone can act on as one item.
    return broken.map((i) => ({
      subject: `sync-stale-${slug(i.provider)}`,
      evidence: {
        provider: i.provider,
        state: i.state,
        lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
        hoursSinceSync: i.lastSyncAt
          ? Math.floor((ctx.now.getTime() - i.lastSyncAt.getTime()) / 3_600_000)
          : null,
        staleAfterHours: ctx.thresholds['sync.staleHours'],
        lastError: i.lastError,
      },
      // A stuck sync is worse than a late one: 'syncing' with an old timestamp means a
      // run started and never finished, so nothing will pick it up on its own.
      severity: i.state === 'error' || i.state === 'syncing' ? 'high' : 'medium',
      proposedAction:
        i.state === 'syncing'
          ? 'Clear the stuck sync and run it again — a run started and never finished, so nothing will retry it.'
          : 'Reconnect the integration and run a sync.',
    }));
  },
};

const seoCtrRule: Rule = {
  id: 'high_impression_low_ctr_page',
  scope: 'standing',
  version: 1,
  section: 'seo',
  severity: 'medium',
  kind: 'opportunity',
  test: 'Pages above the impressions floor whose click-through sits under the CTR floor',
  async run(ctx) {
    const impressionFloor = ctx.thresholds['seo.impressionFloor'];
    const ctrFloor = ctx.thresholds['seo.ctrFloor'];

    const pages = await db().seoPage.findMany({
      where: { impressions: { gt: impressionFloor }, ctr: { lt: ctrFloor } },
      select: { url: true, title: true, impressions: true, clicks: true, ctr: true, avgPosition: true },
      orderBy: { impressions: 'desc' },
      take: 5,
    });
    if (pages.length === 0) return [];

    return pages.map((p) => ({
      subject: `low-ctr-${slug(p.url)}`,
      evidence: {
        url: p.url,
        title: p.title,
        impressions: p.impressions,
        clicks: p.clicks,
        ctrPercent: round(p.ctr),
        basis: 'ctrPercent is this one page’s click-through, not the site’s',
        averagePosition: round(p.avgPosition),
        impressionFloor,
        ctrFloor,
      },
      proposedAction: 'Rewrite the title and meta description on this page.',
    }));
  },
};

const renewalRule: Rule = {
  id: 'renewal_without_task',
  scope: 'standing',
  version: 1,
  section: 'crm',
  severity: 'high',
  kind: 'risk',
  test: 'Won retainers whose anniversary falls inside the renewal window with no open task',
  async run(ctx) {
    const window = ctx.thresholds['crm.renewalWindowDays'];

    // The anniversary is a day of the year, so this is a modular comparison and not a
    // date range — a retainer closed in January is due again next January, whatever year
    // it started. Done in SQL because the arithmetic is the query.
    const rows = await db().$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
        FROM opportunity o
        JOIN pipeline_stage s ON s.id = o."stageId"
       WHERE o."engagementType" = 'retainer'
         AND s."isWon"
         AND o."closedAt" IS NOT NULL
         AND MOD(
               CAST(EXTRACT(doy FROM o."closedAt") - EXTRACT(doy FROM ${ctx.now}::timestamp) + 365 AS int),
               365
             ) <= ${window}
         AND NOT EXISTS (
               SELECT 1 FROM task t
                WHERE t."opportunityId" = o.id AND t.status IN ('open', 'in_progress')
             )`;

    const due = Number(rows[0]?.count ?? 0);
    if (due === 0) return [];

    return [
      {
        subject: 'retainer-renewals-without-a-task',
        evidence: {
          retainersDueInWindow: due,
          windowDays: window,
          basis: 'engagementType read from the deal name; anniversary is the day of year it closed',
        },
        proposedAction:
          'Create a renewal touch task against each retainer whose anniversary falls in the window.',
      },
    ];
  },
};

const dormantCustomerRule: Rule = {
  id: 'review_or_referral_not_requested',
  scope: 'standing',
  version: 1,
  section: 'crm',
  severity: 'medium',
  kind: 'opportunity',
  test: 'Customers won past the dormancy window with nothing logged since',
  async run(ctx) {
    const days = ctx.thresholds['crm.dormantCustomerDays'];
    const cutoff = daysAgo(ctx.now, days);

    const [total, dormant] = await Promise.all([
      db().customer.count({ where: { churnedAt: null } }),
      db().customer.count({
        where: {
          churnedAt: null,
          wonAt: { lt: cutoff },
          company: { is: { activities: { none: { createdAt: { gte: cutoff } } } } },
        },
      }),
    ]);
    if (dormant === 0) return [];

    return [
      {
        subject: 'customers-with-nothing-logged-since-winning-them',
        evidence: {
          dormantCustomers: dormant,
          activeCustomers: total,
          dormantPercent: round(rate(dormant, total)),
          basis: 'dormantPercent is a share of active customers, not of all customers ever won',
          dormantAfterDays: days,
        },
        proposedAction:
          'Run a lifecycle campaign asking these customers for a review or a referral.',
      },
    ];
  },
};

const pacingRule: Rule = {
  id: 'spend_off_pace',
  scope: 'period',
  version: 1,
  section: 'marketing',
  severity: 'high',
  kind: 'anomaly',
  test: 'Month-to-date spend against the budget of the campaigns live this period',
  async run(ctx) {
    const tolerance = ctx.thresholds['marketing.pacingTolerance'];

    // Silent where the firm has set its own envelopes for the quarter. This rule reads
    // the ad platform's budgets, which say what Meta was told to spend; spend_over_
    // envelope reads what the firm decided to spend. Both firing would raise two
    // findings about one overspend, measured against two different numbers, and the
    // reader would have no way to tell which one was the instruction.
    const { periodStart, periodEnd } = quarterOf(ctx.to);
    const envelopes = await envelopesFor(periodStart, periodEnd);
    if (envelopes.length > 0) return [];

    const { budgetPacing } = await import('./metrics.ts').then((m) =>
      m.marketingKpis({ from: ctx.from, to: ctx.to }),
    );
    if (budgetPacing === null) return [];

    const off = Math.abs(budgetPacing - 100);
    if (off <= tolerance) return [];

    const over = budgetPacing > 100;
    return [
      {
        subject: over ? 'spend-over-pace' : 'spend-under-pace',
        evidence: {
          pacingPercent: round(budgetPacing),
          tolerancePercent: tolerance,
          direction: over ? 'over' : 'under',
          // Said in the evidence because the model will otherwise call this "plan", and
          // §22's budget envelope — a plan the firm sets — does not exist yet.
          basis: "the ad platform's own campaign budgets, not a plan the firm set",
        },
        proposedAction: over
          ? 'Review the live campaign budgets against what the firm intended to spend this month.'
          : 'Decide whether the under-spend is deliberate before the month closes.',
      },
    ];
  },
};

const envelopeRule: Rule = {
  id: 'spend_over_envelope',
  scope: 'period',
  version: 1,
  section: 'marketing',
  severity: 'high',
  kind: 'risk',
  test: "Channel spend against the envelope the firm set for the period",
  async run(ctx) {
    // The quarter the window ends in. An envelope is a quarterly instruction, so a
    // 90-day report window straddling two quarters is judged against the one it finishes
    // in rather than against a blend of both, which would belong to no decision anybody
    // made.
    const { periodStart, periodEnd, label } = quarterOf(ctx.to);
    const envelopes = await envelopesFor(periodStart, periodEnd);

    // Over the envelope, and over the tolerance the workspace allows either side of a
    // plan. The same tolerance the pacing rule uses: an envelope exceeded by a rupee is
    // not an exception, and flagging it would train people to ignore the flag.
    const tolerance = ctx.thresholds['marketing.pacingTolerance'];

    return envelopes
      .filter((e) => e.usedPercent !== null && e.usedPercent > 100 + tolerance)
      .map((e) => ({
        subject: `spend-over-envelope-${slug(e.channelName)}-${slug(label)}`,
        evidence: {
          channel: e.channelName,
          period: label,
          envelope: Math.round(e.envelopeInReporting ?? 0),
          spent: Math.round(e.spent),
          usedPercent: round(e.usedPercent),
          overBy: Math.round(e.spent - (e.envelopeInReporting ?? 0)),
          tolerancePercent: tolerance,
          currency: e.reportingCurrency,
          setBy: e.setByEmail,
          basis: "the envelope the firm set for this channel, not the ad platform's own budget",
        },
        proposedAction: `Decide whether to raise the ${e.channelName} envelope for ${label} or pull the spend back.`,
      }));
  },
};

const placeholderRule: Rule = {
  id: 'template_placeholder',
  scope: 'standing',
  version: 1,
  section: 'outreach',
  severity: 'critical',
  kind: 'risk',
  test: 'Unresolved tokens or bracketed placeholders in a sequence that is not archived',
  async run() {
    const sequences = await db().sequence.findMany({
      where: { status: { not: 'archived' } },
      select: {
        id: true,
        name: true,
        status: true,
        steps: { select: { position: true, subject: true, body: true }, orderBy: { position: 'asc' } },
      },
    });

    const broken = sequences
      .map((s) => ({ sequence: s, lint: summarise(lintSequence(s.steps)) }))
      .filter((r) => r.lint.critical > 0);
    if (broken.length === 0) return [];

    // Per sequence: each is a different template with a different fix, and this is the
    // one Critical rule in the library that can actually run today.
    return broken.map(({ sequence, lint }) => ({
      subject: `placeholder-${slug(sequence.id)}`,
      evidence: {
        sequence: sequence.name,
        status: sequence.status,
        criticalFindings: lint.critical,
        reviewFindings: lint.review,
        // The distinct codes, not every finding: a template with eight instances of one
        // placeholder needs the same fix as one with a single instance, and listing all
        // eight would give the model eight numbers to weigh.
        codes: [...new Set(lint.findings.map((f) => f.code))].join(', '),
        // Stated because it changes what this means: Smartlead owns sending, so nothing
        // here is going out right now — but nothing here can stop it either.
        basis: 'no sequence in this workspace is active; the app cannot pause one',
      },
      proposedAction: 'Fix the unresolved tokens in this template before it is ever set live.',
    }));
  },
};

export const RULES: Rule[] = [
  attributionRule,
  placeholderRule,
  envelopeRule,
  syncStaleRule,
  leadSlaRule,
  renewalRule,
  pacingRule,
  staleDealsRule,
  taskDebtRule,
  dormantCustomerRule,
  seoCtrRule,
];

export const RULE_IDS = RULES.map((r) => r.id);

/** Ordered worst first, so the model is asked to narrate what matters in that order and
 *  the page reads top-down. */
const SEVERITY_ORDER: Record<RuleSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

export type RaisedFinding = Finding & {
  ruleId: string;
  ruleVersion: number;
  section: RuleSection;
  kind: InsightKind;
  severity: RuleSeverity;
  test: string;
};

/**
 * Runs every rule and returns what fired, worst first.
 *
 * A rule that throws is skipped with its id logged rather than failing the run. One
 * broken query should not silence the other nine — and a run that returns nothing is
 * indistinguishable on screen from a workspace with no problems, which is the worst
 * possible way for this to fail.
 */
export async function runRules(
  window: { from: Date; to: Date },
  now = new Date(),
): Promise<RaisedFinding[]> {
  const [limits, currency] = await Promise.all([
    thresholds(),
    import('./settings.ts').then((s) => s.currencySettings().then((c) => c.reporting)),
  ]);

  const ctx: RuleContext = { from: window.from, to: window.to, now, thresholds: limits, currency };

  const results = await Promise.all(
    RULES.map(async (rule) => {
      try {
        const findings = await rule.run(ctx);
        return findings.map((f) => ({
          ...f,
          ruleId: rule.id,
          ruleVersion: rule.version,
          section: rule.section,
          kind: rule.kind,
          severity: f.severity ?? rule.severity,
          test: rule.test,
        }));
      } catch (e) {
        console.error(`[rules] ${rule.id} failed: ${(e as Error).message}`);
        return [];
      }
    }),
  );

  return results
    .flat()
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ── helpers ───────────────────────────────────────────────────────────────────────────

/** Two decimal places, or null. Rounded here rather than in the sentence, so the figure
 *  the model is given is exactly the figure it may quote. */
function round(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Number(n.toFixed(2));
}

/** A subject fragment safe to put in a fingerprint. Long values are hashed down by
 *  normaliseSubject afterwards; this only removes what would make two subjects differ on
 *  punctuation alone. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
