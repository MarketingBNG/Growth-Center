import { z } from 'zod';
import { db } from './prisma.ts';
import { dispatch } from './events.ts';

export const opportunityInput = z.object({
  name: z.string().trim().min(1).max(160),
  pipelineId: z.string().cuid(),
  stageId: z.string().cuid(),
  value: z.number().nonnegative().max(1_000_000_000),
  currency: z.string().trim().length(3).default('USD'),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().date().optional(),
  ownerEmail: z.string().trim().email().optional(),
  leadId: z.string().cuid().optional(),
  contactId: z.string().cuid().optional(),
  companyId: z.string().cuid().optional(),
  campaignId: z.string().cuid().optional(),
});

export type OpportunityInput = z.infer<typeof opportunityInput>;

export async function defaultPipeline() {
  return db().pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
}

/** How many open deals the board will render at once. */
export const BOARD_LIMIT = 300;

export async function board(pipelineId?: string) {
  const pipeline = pipelineId
    ? await db().pipeline.findUnique({
        where: { id: pipelineId },
        include: { stages: { orderBy: { position: 'asc' } } },
      })
    : await defaultPipeline();
  if (!pipeline) return null;

  // Capped, and the cap is reported rather than silently applied — the board renders a
  // draggable card per deal, so an uncapped query is an uncapped page. Most-recently
  // touched first, because that is the working set. `openPipeline()` in lib/metrics.ts
  // still counts and values EVERY open deal, so the KPI totals stay complete even when
  // the board is showing a slice.
  const [opportunities, openTotal] = await Promise.all([
    db().opportunity.findMany({
      where: { pipelineId: pipeline.id, closedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: BOARD_LIMIT,
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db().opportunity.count({ where: { pipelineId: pipeline.id, closedAt: null } }),
  ]);

  return {
    pipeline,
    openTotal,
    truncated: openTotal > opportunities.length,
    columns: pipeline.stages.map((stage) => ({
      stage,
      cards: opportunities.filter((o) => o.stageId === stage.id),
    })),
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

  const opp = await db().opportunity.create({
    data: {
      ...input,
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
      select: { pipelineId: true, stageId: true, stage: { select: { name: true } } },
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

  await db().opportunity.update({
    where: { id },
    data: {
      stageId,
      probability: stage.isWon ? 100 : stage.isLost ? 0 : stage.probability,
      closedAt: closing ? new Date() : null,
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

  const opp = await db().opportunity.create({
    data: {
      name,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      value,
      probability: firstStage.probability,
      ownerEmail: lead.ownerEmail,
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
