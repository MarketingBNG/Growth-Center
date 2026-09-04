// Equal distribution of untouched leads across the people who work them.
//
// Deterministic on purpose, for the same reason pickOwner() in lib/automation.ts is:
// dividing leads between people is arithmetic, and arithmetic somebody has to be able to
// check when they are the one losing forty leads. A model asked the same question answers
// differently each run, cannot be unit-tested, and bills tokens for long division.
//
// The pure planner is at the top and touches no database, so tools/allocation.test.ts can
// exercise every edge of the split directly.

import { db, prisma } from './prisma.ts';
import { pushLeadOwners } from './integrations/service.ts';
import { ALLOWED_DOMAINS } from './roles.ts';

/**
 * Zoho's own word for a lead nobody has worked yet, not a heuristic of ours.
 *
 * `status` is the shared vocabulary and collapses this org's wording, so it cannot say
 * this: 2,882 of the 2,886 leads mapped to `new` carry exactly this sourceStatus, and the
 * distinctions the team works to live in the CRM's own string. Deriving "untouched" from
 * the absence of a logged call would be a different and much larger set — 8,436 open
 * leads have no activity — and most of that is worked and given up on, not untouched.
 */
export const UNTOUCHED_STATUS = 'Untouched Lead';

/** AppSetting key holding the addresses allowed to receive leads, when the team has set
 *  one. Absent by default; eligibleOwners() derives a list instead. */
export const OWNERS_KEY = 'allocation.owners';

/**
 * Addresses that own leads but are not people.
 *
 * zoho.one is the integration's own mailbox — 323 leads arrived under it because that is
 * who the API authenticated as, not because anyone is working them. Left out of the
 * derived roster: handing it a fair share parks leads where nobody looks.
 */
const SYSTEM_MAILBOXES = ['zoho.one@usaindiacfo.com'];

/** One person's untouched leads. `email` is null for the unassigned pool. */
export type Holding = {
  email: string | null;
  /** Oldest first. The planner hands out from the front. */
  leadIds: string[];
};

export type Move = { leadId: string; from: string | null; to: string };

export type Plan = {
  /** Untouched leads divided by eligible people, before any rounding. */
  fairShare: number;
  /** The whole number each person is levelled to. */
  target: number;
  moves: Move[];
  before: Record<string, number>;
  after: Record<string, number>;
  /** Leads a receiver had room for that the run's cap held back. */
  deferred: number;
};

export type PlanOptions = {
  /**
   * How far above fair share somebody may sit before being asked to give any up.
   *
   * Without it a nightly run would shuttle one lead back and forth between two people who
   * are a single record apart, each move writing to Zoho and logging an activity on the
   * lead.
   */
  tolerance?: number;
  /** Ceiling on a single run, so the first one cannot move two thousand leads at once. */
  limit?: number;
};

export const UNASSIGNED = '(unassigned)';
const keyOf = (email: string | null) => email ?? UNASSIGNED;

/**
 * Works out who gives, who receives, and which leads move.
 *
 * Pure and total: the same holdings give the same moves every time. Ordering is settled by
 * count and then by address so two runs over identical data cannot disagree — which is what
 * makes the preview worth showing, because the plan someone approves is the plan that runs.
 */
export function planMoves(holdings: Holding[], options: PlanOptions = {}): Plan {
  const tolerance = options.tolerance ?? 0.1;
  const limit = options.limit ?? 200;

  // The unassigned pool donates and never receives: those leads belong to nobody, so there
  // is no fair share to hold back for it.
  const people = holdings.filter((h) => h.email !== null);
  const unassigned = holdings.find((h) => h.email === null);

  const before: Record<string, number> = {};
  for (const h of holdings) before[keyOf(h.email)] = h.leadIds.length;

  const plan: Plan = {
    fairShare: 0,
    target: 0,
    moves: [],
    before,
    after: { ...before },
    deferred: 0,
  };
  if (!people.length) return plan;

  const total = people.reduce((n, h) => n + h.leadIds.length, 0) + (unassigned?.leadIds.length ?? 0);
  const fairShare = total / people.length;
  const target = Math.floor(fairShare);
  plan.fairShare = fairShare;
  plan.target = target;

  // Anyone this far above fair share comes down to the whole-number target — not down to
  // the ceiling, or the next run finds them over it again.
  const ceiling = fairShare * (1 + tolerance);

  const donors = people
    .filter((h) => h.leadIds.length > ceiling && h.leadIds.length > target)
    .map((h) => ({
      email: h.email as string,
      available: h.leadIds.slice(0, h.leadIds.length - target),
    }))
    .sort((a, b) => b.available.length - a.available.length || a.email.localeCompare(b.email));

  // Unassigned leads go out before anyone is asked to give one up: they cost nobody
  // anything, and each one handed over is a lead that now has an owner.
  const pool = unassigned?.leadIds.length
    ? [{ email: null as string | null, available: [...unassigned.leadIds] }, ...donors]
    : (donors as { email: string | null; available: string[] }[]);

  const receivers = people
    .filter((h) => h.leadIds.length < target)
    .map((h) => ({ email: h.email as string, need: target - h.leadIds.length }))
    .sort((a, b) => b.need - a.need || a.email.localeCompare(b.email));

  const remaining = (from: number) => receivers.slice(from).reduce((n, r) => n + r.need, 0);

  let p = 0;
  for (let i = 0; i < receivers.length; i++) {
    const receiver = receivers[i];

    for (let filled = 0; filled < receiver.need; filled++) {
      while (p < pool.length && !pool[p].available.length) p++;

      // Out of donors, or out of room in this run. Everything still wanted is counted so
      // the preview says the run is partial instead of looking like it finished.
      if (p >= pool.length || plan.moves.length >= limit) {
        plan.deferred = receiver.need - filled + remaining(i + 1);
        return plan;
      }

      const donor = pool[p];
      const leadId = donor.available.shift() as string;
      plan.moves.push({ leadId, from: donor.email, to: receiver.email });
      plan.after[keyOf(donor.email)]--;
      plan.after[receiver.email]++;
    }
  }

  return plan;
}

/**
 * Everyone allowed to receive a lead: the people currently holding at least one open one.
 *
 * Not the workspace roster. app_user holds three accounts and not one of them owns a lead,
 * so a split across that list would strip 2,882 leads off the people working them and hand
 * them to nobody.
 *
 * But "anyone who owns a lead" is too loose in the other direction, and visibly so. Twenty
 * of the forty addresses on the lead table hold between one and fourteen records with
 * nothing open — a partner with a single lead from 2024, five people with one each, four
 * personal gmail duplicates of staff accounts. Derived that way the split had 34 people in
 * it, and the first run handed 75 leads each to a partner and to two people with no open
 * leads at all. Holding an open lead is the available evidence that somebody is in the
 * calling rotation this month.
 *
 * Filtered to the company domains too, so an off-domain duplicate of someone's account is
 * not counted as a second person and given a second share.
 *
 * Overridable through AppSetting, which is the way to add somebody new — they hold nothing
 * open yet, so nothing here can infer they have joined.
 */
export async function eligibleOwners(): Promise<string[]> {
  const client = prisma();
  if (!client) return [];

  const configured = await client.appSetting.findUnique({ where: { key: OWNERS_KEY } });
  if (Array.isArray(configured?.value)) {
    return (configured.value as unknown[]).filter((v): v is string => typeof v === 'string');
  }

  const rows = await client.lead.groupBy({
    by: ['ownerEmail'],
    where: { ownerEmail: { not: null }, status: { in: ['new', 'contacted'] } },
    _count: { _all: true },
  });

  return rows
    .map((r) => r.ownerEmail as string)
    .filter((email) => {
      const domain = email.split('@')[1]?.toLowerCase();
      return !!domain && ALLOWED_DOMAINS.includes(domain) && !SYSTEM_MAILBOXES.includes(email.toLowerCase());
    })
    .sort();
}

/**
 * The untouched leads each eligible person holds, oldest first.
 *
 * Oldest first so the records handed over are the ones that have waited longest for a call.
 * Newest first would leave the stalest leads exactly where they have been ignored and move
 * the ones somebody was about to ring.
 */
export async function untouchedHoldings(owners: string[]): Promise<Holding[]> {
  const client = prisma();
  if (!client) return [];

  const leads = await client.lead.findMany({
    where: {
      sourceStatus: UNTOUCHED_STATUS,
      OR: [{ ownerEmail: { in: owners } }, { ownerEmail: null }],
    },
    select: { id: true, ownerEmail: true },
    orderBy: { createdAt: 'asc' },
  });

  // Seeded with every eligible person, so somebody holding none is a receiver rather than
  // missing from the split entirely.
  const byOwner = new Map<string | null, string[]>(owners.map((e) => [e, []]));
  for (const lead of leads) {
    const key = lead.ownerEmail;
    if (!byOwner.has(key)) byOwner.set(key, []);
    (byOwner.get(key) as string[]).push(lead.id);
  }

  return [...byOwner.entries()].map(([email, leadIds]) => ({ email, leadIds }));
}

export type Preview = {
  plan: Plan;
  /** Everyone in the split, whether they gave, received or were left alone. */
  owners: string[];
  untouched: number;
};

/** The plan, without writing anything. What the confirm screen renders. */
export async function previewAllocation(options: PlanOptions = {}): Promise<Preview> {
  const owners = await eligibleOwners();
  const holdings = await untouchedHoldings(owners);
  return {
    plan: planMoves(holdings, options),
    owners,
    untouched: holdings.reduce((n, h) => n + h.leadIds.length, 0),
  };
}

export type ApplyResult = {
  plan: Plan;
  /** Moves that reached the CRM and this database. */
  applied: Move[];
  failed: { leadId: string; reason: string }[];
};

/**
 * Runs the plan: CRM first, then here.
 *
 * That order is the whole point. The nightly sync writes `ownerEmail` from Zoho over every
 * lead, so a local update the CRM did not accept is not a reassignment — it is a number on
 * a screen that reverts at 01:30 while everyone believes the leads were shared out. Only
 * what Zoho confirms is written locally.
 */
export async function applyAllocation(actorEmail: string, options: PlanOptions = {}): Promise<ApplyResult> {
  const preview = await previewAllocation(options);
  const plan = preview.plan;
  if (!plan.moves.length) return { plan, applied: [], failed: [] };

  const leads = await db().lead.findMany({
    where: { id: { in: plan.moves.map((m) => m.leadId) } },
    select: { id: true, source: true, externalId: true },
  });
  const provenance = new Map(leads.map((l) => [l.id, l]));

  const byProvider = new Map<string, Move[]>();
  const applied: Move[] = [];
  const failed: { leadId: string; reason: string }[] = [];

  for (const move of plan.moves) {
    const lead = provenance.get(move.leadId);
    if (!lead) {
      failed.push({ leadId: move.leadId, reason: 'Lead no longer exists.' });
      continue;
    }
    // A lead this app created itself has no system of record to push to, so it is ours to
    // move outright. Nothing here creates leads that way yet, but the public intake route
    // can, and silently dropping those would be the kind of gap nobody notices.
    if (!lead.source || !lead.externalId) {
      applied.push(move);
      continue;
    }
    const batch = byProvider.get(lead.source) ?? [];
    batch.push(move);
    byProvider.set(lead.source, batch);
  }

  for (const [providerId, batch] of byProvider) {
    const result = await pushLeadOwners(
      providerId,
      batch.map((m) => ({
        externalId: provenance.get(m.leadId)?.externalId as string,
        ownerEmail: m.to,
      })),
    );

    // No write path or not connected. Deliberately not written locally: an owner this
    // database believes in and the CRM does not is worse than no change at all, because
    // the team works from both.
    if (!result) {
      for (const move of batch) {
        failed.push({
          leadId: move.leadId,
          reason: `${providerId} cannot accept owner changes, so the reassignment would be reverted by the next sync.`,
        });
      }
      continue;
    }

    const written = new Set(result.written);
    const reasons = new Map(result.failed.map((f) => [f.externalId, f.reason]));
    for (const move of batch) {
      const externalId = provenance.get(move.leadId)?.externalId as string;
      if (written.has(externalId)) applied.push(move);
      else failed.push({ leadId: move.leadId, reason: reasons.get(externalId) ?? 'The CRM did not confirm the change.' });
    }
  }

  if (applied.length) {
    // Grouped by destination so 200 moves are a handful of statements rather than 200 round
    // trips — the same reason bulkUpsert exists in lib/integrations/service.ts.
    const byOwner = new Map<string, string[]>();
    for (const move of applied) {
      const ids = byOwner.get(move.to) ?? [];
      ids.push(move.leadId);
      byOwner.set(move.to, ids);
    }

    await db().$transaction([
      ...[...byOwner.entries()].map(([ownerEmail, ids]) =>
        db().lead.updateMany({ where: { id: { in: ids } }, data: { ownerEmail } }),
      ),
      db().activity.createMany({
        data: applied.map((move) => ({
          type: 'owner_changed' as const,
          summary: `Rebalanced to ${move.to}`,
          actorEmail,
          detail: { from: move.from, to: move.to, rule: 'equal split of untouched leads' },
          leadId: move.leadId,
        })),
      }),
      // One row for the act itself, alongside the per-lead history.
      //
      // The Activity rows above are the right record for a lead — "how did this lead get
      // to me" is answerable from the lead. But a rebalance of two thousand leads is one
      // decision by one person, and recorded only as two thousand rows it is invisible as
      // a decision: there is nothing to find unless you already know which lead to open.
      // Not a duplicate of the Activity rows, a different fact at a different grain.
      db().auditEvent.create({
        data: {
          actorEmail,
          action: 'leads.rebalance',
          entityType: 'lead',
          detail: {
            leadsMoved: applied.length,
            owners: byOwner.size,
            rule: 'equal split of untouched leads',
            ...(failed.length ? { failedToWriteBack: failed.length } : {}),
          },
        },
      }),
    ]);
  }

  return { plan, applied, failed };
}

export type OwnerWorkload = {
  email: string;
  /** Leads the CRM still calls untouched. What the rebalance divides. */
  untouched: number;
  /** Open leads (new or contacted) — the raw figure, kept for comparison. */
  open: number;
  /**
   * Open leads the CRM has marked Not Reachable.
   *
   * Broken out because it is what makes the raw figure misleading: the largest holder's
   * 3,299 open leads are 3,284 Not Reachable, which is a record of calls that did not
   * connect and not a queue of work. Levelling the raw count would move a graveyard.
   */
  notReachable: number;
  /** Open leads with a call or meeting logged in the last 30 days. */
  active: number;
};

/**
 * What each person is actually carrying.
 *
 * Four figures rather than one because the raw lead count cannot be read on its own — see
 * `notReachable`. Anything deciding who is overloaded, the AI included, needs all four or
 * it reaches the same wrong conclusion.
 */
export async function ownerWorkload(): Promise<OwnerWorkload[]> {
  const client = prisma();
  if (!client) return [];

  const owners = await eligibleOwners();
  if (!owners.length) return [];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Four grouped counts in one round trip rather than four sequential ones — the same
  // reason pickOwner() in lib/automation.ts pairs its two reads.
  const [untouched, openLeads, notReachable, active] = await Promise.all([
    client.lead.groupBy({
      by: ['ownerEmail'],
      where: { ownerEmail: { in: owners }, sourceStatus: UNTOUCHED_STATUS },
      _count: { _all: true },
    }),
    client.lead.groupBy({
      by: ['ownerEmail'],
      where: { ownerEmail: { in: owners }, status: { in: ['new', 'contacted'] } },
      _count: { _all: true },
    }),
    client.lead.groupBy({
      by: ['ownerEmail'],
      where: {
        ownerEmail: { in: owners },
        status: { in: ['new', 'contacted'] },
        sourceStatus: 'Not Reachable',
      },
      _count: { _all: true },
    }),
    client.lead.groupBy({
      by: ['ownerEmail'],
      where: {
        ownerEmail: { in: owners },
        status: { in: ['new', 'contacted'] },
        activities: { some: { createdAt: { gte: since } } },
      },
      _count: { _all: true },
    }),
  ]);

  const tally = (rows: { ownerEmail: string | null; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.ownerEmail as string, r._count._all]));

  const untouchedBy = tally(untouched);
  const openBy = tally(openLeads);
  const notReachableBy = tally(notReachable);
  const activeBy = tally(active);

  return owners
    .map((email) => ({
      email,
      untouched: untouchedBy.get(email) ?? 0,
      open: openBy.get(email) ?? 0,
      notReachable: notReachableBy.get(email) ?? 0,
      active: activeBy.get(email) ?? 0,
    }))
    .sort((a, b) => b.open - a.open || a.email.localeCompare(b.email));
}
