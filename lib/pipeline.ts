import { z } from 'zod';
import { recordId } from './id.ts';
import { INTERNAL_SOURCE } from './sources.ts';
import { db } from './prisma.ts';
import { currencySettings } from './settings.ts';
import { dispatch } from './events.ts';

/**
 * Editable fields on an existing deal. Deliberately excludes pipelineId and stageId:
 * a stage move has its own path (moveOpportunity) because it emits the won/lost events
 * that create and reverse revenue. Letting a plain edit change the stage would move a
 * deal without any of that firing.
 */
export const opportunityPatch = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  value: z.number().nonnegative().max(1_000_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.string().date().nullable().optional(),
  ownerEmail: z.string().trim().email().nullable().optional(),
});

export const opportunityInput = z.object({
  name: z.string().trim().min(1).max(160),
  pipelineId: recordId,
  stageId: recordId,
  value: z.number().nonnegative().max(1_000_000_000),
  // Optional, not defaulted to USD: this workspace reports in rupees, and a deal typed
  // into the app would otherwise be recorded in a currency nobody chose and converted on
  // every screen that shows it. Filled from the workspace setting at creation.
  currency: z.string().trim().length(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().date().optional(),
  ownerEmail: z.string().trim().email().optional(),
  leadId: recordId.optional(),
  contactId: recordId.optional(),
  companyId: recordId.optional(),
  campaignId: recordId.optional(),
});

export type OpportunityInput = z.infer<typeof opportunityInput>;

export async function defaultPipeline() {
  return db().pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
}

/** How many open deals the board will render at once. */
/**
 * What counts as an open deal.
 *
 * Not `closedAt: null` alone. Zoho leaves Closing_Date empty on 982 of its won deals and
 * the sync will not invent one — stamping the import date would move that revenue into
 * whichever month the sync ran. So 1,122 deals sit in "Deal Complete", "Project In
 * Progress" or "Deal Lost" with no close date, and every query that asked only for a null
 * one counted them as still in play: the board reported 2,082 open deals worth
 * Rs.125m when 960 were open.
 *
 * A deal in a won or lost stage is not open, whatever its dates say.
 */
export const OPEN_DEAL = {
  closedAt: null,
  stage: { isWon: false, isLost: false },
} as const;

/** Per column, not per board. A flat cap took the 300 most recently touched deals across
 *  the whole pipeline, and 820 of this workspace's 960 open deals sit in the first stage —
 *  so all 300 came from it and the other five columns rendered empty while holding 140
 *  deals between them. */
export const BOARD_LIMIT = 60;

export async function board(pipelineId?: string) {
  const pipeline = pipelineId
    ? await db().pipeline.findUnique({
        where: { id: pipelineId },
        include: { stages: { orderBy: { position: 'asc' } } },
      })
    : await defaultPipeline();
  if (!pipeline) return null;

  // One query per column rather than one for the board, so every stage shows its own
  // most-recently-touched deals. The board renders a draggable card each, so the cap
  // stays — but it is reported per column, and `openPipeline()` in lib/metrics.ts still
  // counts and values EVERY open deal, so the KPI totals stay complete.
  const [perStage, counts] = await Promise.all([
    Promise.all(
      pipeline.stages.map((stage) =>
        db().opportunity.findMany({
          where: { pipelineId: pipeline.id, stageId: stage.id, ...OPEN_DEAL },
          orderBy: { updatedAt: 'desc' },
          take: BOARD_LIMIT,
          include: {
            company: { select: { id: true, name: true } },
            contact: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ),
    ),
    db().opportunity.groupBy({
      by: ['stageId'],
      where: { pipelineId: pipeline.id, ...OPEN_DEAL },
      _count: { _all: true },
    }),
  ]);

  const totalFor = new Map(counts.map((c) => [c.stageId, c._count._all]));
  const columns = pipeline.stages.map((stage, i) => ({
    stage,
    cards: perStage[i],
    /** Every open deal in this stage, which is not always what `cards` holds. */
    total: totalFor.get(stage.id) ?? 0,
  }));

  return {
    pipeline,
    openTotal: columns.reduce((n, c) => n + c.total, 0),
    truncated: columns.some((c) => c.cards.length < c.total),
    columns,
  };
}

export async function createOpportunity(input: OpportunityInput, actorEmail: string) {
  const stage = await db().pipelineStage.findUnique({
    where: { id: input.stageId },
    select: { pipelineId: true, probability: true },
  });
  if (!stage || stage.pipelineId !== input.pipelineId) {
    throw new Error('Stage does not belong to that pipeline');
  }

  const fx = await currencySettings();
  const opp = await db().opportunity.create({
    data: {
      ...input,
      // Same reason as leads and companies: a null source is the seeder's, and a deal
      // someone opened here would carry its amber "never real" badge across the board.
      source: INTERNAL_SOURCE,
      // The workspace's currency unless the caller named one.
      currency: input.currency ?? fx.reporting,
      expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
      probability: input.probability ?? stage.probability,
    },
    select: { id: true },
  });

  await db().activity.create({
    data: {
      type: 'created',
      summary: `Opportunity created: ${input.name}`,
      actorEmail,
      opportunityId: opp.id,
    },
  });

  return opp;
}

/**
 * Moves a deal between stages. Landing on a won or lost stage closes it and, for a
 * win, emits opportunity.won so revenue and the customer record follow.
 */
export async function moveOpportunity(id: string, stageId: string, actorEmail: string) {
  const [opp, stage] = await Promise.all([
    db().opportunity.findUnique({
      where: { id },
      select: {
        pipelineId: true,
        stageId: true,
        closedAt: true,
        stage: { select: { name: true, isWon: true } },
      },
    }),
    db().pipelineStage.findUnique({
      where: { id: stageId },
      select: { pipelineId: true, name: true, probability: true, isWon: true, isLost: true },
    }),
  ]);

  if (!opp) return { ok: false as const, reason: 'not_found' as const };
  if (!stage) return { ok: false as const, reason: 'bad_stage' as const };
  if (stage.pipelineId !== opp.pipelineId) return { ok: false as const, reason: 'bad_stage' as const };
  if (opp.stageId === stageId) return { ok: true as const, unchanged: true };

  const closing = stage.isWon || stage.isLost;

  // The date it FIRST closed, not the date it last moved. This pipeline has three won
  // stages — Deal Complete, then the two Project stages the work goes through — so moving
  // a deal along after the sale would otherwise re-stamp it with today, and the revenue
  // derived from that date would jump to the current month each time.
  const closedAt = closing ? (opp.closedAt ?? new Date()) : null;

  await db().opportunity.update({
    where: { id },
    data: {
      stageId,
      probability: stage.isWon ? 100 : stage.isLost ? 0 : stage.probability,
      closedAt,
    },
  });

  await db().activity.create({
    data: {
      type: 'stage_changed',
      summary: `Moved from ${opp.stage.name} to ${stage.name}`,
      actorEmail,
      detail: { fromStageId: opp.stageId, toStageId: stageId },
      opportunityId: id,
    },
  });

  if (stage.isWon) await dispatch({ type: 'opportunity.won', opportunityId: id, actorEmail });
  if (stage.isLost) await dispatch({ type: 'opportunity.lost', opportunityId: id, actorEmail });

  // Dragged back out of a won stage without being lost. Nothing fired for this before, so
  // correcting a mis-click left the revenue and the customer it created standing —
  // exactly the hole opportunity.lost was written to close, one move to the left.
  if (opp.stage.isWon && !stage.isWon && !stage.isLost) {
    await dispatch({ type: 'opportunity.reopened', opportunityId: id, actorEmail });
  }

  return { ok: true as const, unchanged: false };
}

/**
 * Turns a qualified lead into a deal, carrying its company, contact and campaign so
 * attribution survives the handoff.
 */
export async function convertLead(leadId: string, actorEmail: string, value = 0) {
  const lead = await db().lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, firstName: true, lastName: true, companyName: true, ownerEmail: true,
      companyId: true, contactId: true, campaignId: true, status: true,
    },
  });
  if (!lead) return { ok: false as const, reason: 'not_found' as const };
  if (lead.status === 'converted') return { ok: false as const, reason: 'already_converted' as const };

  const pipeline = await defaultPipeline();
  const firstStage = pipeline?.stages.find((s) => !s.isWon && !s.isLost);
  if (!pipeline || !firstStage) return { ok: false as const, reason: 'no_pipeline' as const };

  const who = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  const name = lead.companyName?.trim() || who || 'New opportunity';

  const fx = await currencySettings();
  const opp = await db().opportunity.create({
    data: {
      name,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      value,
      currency: fx.reporting,
      probability: firstStage.probability,
      ownerEmail: lead.ownerEmail,
      source: INTERNAL_SOURCE,
      leadId: lead.id,
      contactId: lead.contactId,
      companyId: lead.companyId,
      campaignId: lead.campaignId,
    },
    select: { id: true },
  });

  await db().lead.update({
    where: { id: leadId },
    data: { status: 'converted', convertedAt: new Date() },
  });

  await db().activity.createMany({
    data: [
      {
        type: 'converted',
        summary: `Converted to opportunity "${name}"`,
        actorEmail,
        detail: { opportunityId: opp.id },
        leadId: lead.id,
      },
      {
        type: 'created',
        summary: `Created from lead ${who}`,
        actorEmail,
        detail: { leadId: lead.id },
        opportunityId: opp.id,
      },
    ],
  });

  await dispatch({ type: 'lead.converted', leadId: lead.id, opportunityId: opp.id, actorEmail });
  return { ok: true as const, opportunityId: opp.id };
}

/**
 * Edits a deal's own attributes. Value, owner, name and close date were all fixed at
 * creation with no way to correct any of them.
 *
 * A changed value rewrites the revenue entry of an already-won deal too — otherwise
 * correcting the amount would leave reported revenue on the old figure.
 */
export async function updateOpportunity(
  id: string,
  input: z.infer<typeof opportunityPatch>,
  actorEmail: string,
) {
  const existing = await db().opportunity.findUnique({
    where: { id },
    select: { id: true, name: true, value: true, currency: true, ownerEmail: true },
  });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.value !== undefined) data.value = input.value;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.probability !== undefined) data.probability = input.probability;
  if (input.ownerEmail !== undefined) data.ownerEmail = input.ownerEmail;
  if (input.expectedCloseDate !== undefined) {
    data.expectedCloseDate = input.expectedCloseDate ? new Date(input.expectedCloseDate) : null;
  }

  if (Object.keys(data).length === 0) return { id, unchanged: true as const };

  await db().opportunity.update({ where: { id }, data });

  // The amount AND the currency: correcting a deal from 1,000 dollars to 87,000 rupees
  // changed both, and rewriting only the number left an entry reading 87,000 dollars —
  // a correction that made the figure ninety times worse than the mistake.
  const valueChanged = input.value !== undefined && Number(existing.value) !== input.value;
  const currencyChanged = input.currency !== undefined && existing.currency !== input.currency;

  if (valueChanged || currencyChanged) {
    await db().revenueEntry.updateMany({
      where: { opportunityId: id },
      data: {
        ...(valueChanged ? { amount: input.value } : {}),
        ...(currencyChanged ? { currency: input.currency } : {}),
      },
    });
  }

  const changed = Object.keys(data).join(', ');
  await db().activity.create({
    data: {
      type: input.ownerEmail !== undefined ? 'owner_changed' : 'status_changed',
      summary: `Updated ${changed}`,
      actorEmail,
      opportunityId: id,
    },
  });

  return { id, unchanged: false as const };
}
