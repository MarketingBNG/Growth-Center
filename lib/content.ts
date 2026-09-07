import { z } from 'zod';
import { db } from './prisma.ts';
import {
  APPROVAL_LABELS,
  approvalState,
  canPublish,
  contentHash,
  reviewAgeHours,
  type ApprovalState,
} from './content-approval.ts';
import { CONTENT_PIPELINE, CONTENT_REVIEW_STATUS, CONTENT_STATUSES } from './enums.ts';
import { COMPANY_SEGMENTS } from './company-facts.ts';
import { FORMATS, MAX_BRIEF, SERVICE_LINES, TOPIC_CLUSTERS } from './content-fields.ts';
import { rate } from './calc.ts';

export const contentInput = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(CONTENT_STATUSES).default('idea'),
  format: z.enum(FORMATS).default('blog'),
  authorEmail: z.string().trim().email().optional(),
  channelSlug: z.string().trim().max(60).optional(),
  campaignId: z.string().min(1).optional(),
  brief: z.string().trim().max(MAX_BRIEF).optional(),
  url: z.string().trim().max(500).optional(),
  publishDate: z.string().date().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),

  // §15.2. Everything the agent reviews and everything the reports count hangs off these,
  // and the board had none of them.
  topicCluster: z.enum(TOPIC_CLUSTERS).nullable().optional(),
  segment: z.enum(COMPANY_SEGMENTS).nullable().optional(),
  serviceLine: z.enum(SERVICE_LINES).nullable().optional(),
  targetKeyword: z.string().trim().max(200).nullable().optional(),
  designerEmail: z.string().trim().email().nullable().optional(),
  partnerVoice: z.string().trim().max(120).nullable().optional(),
  assetUrl: z.string().trim().max(500).nullable().optional(),
  // The parent this piece was cut from. §15.4's webinar produces the clip, the blog and
  // the remarketing audience, and each of them points back here.
  parentId: z.string().min(1).nullable().optional(),
});

export type ContentInput = z.infer<typeof contentInput>;

/**
 * What a person may change about a piece after it exists.
 *
 * Every field is optional and `null` means "clear it", which is why this is not
 * `contentInput.partial()`: the create schema cannot tell an omitted field from a
 * deliberately emptied one, and an edit form sends the whole record every time.
 *
 * `status` is absent on purpose. Moving a piece is `setContentStatus`, which enforces
 * §15.3's ordering and §21.2's publish gate — a status that could also be written through
 * here would be a way around both.
 *
 * The performance columns are absent for the same kind of reason: `views` and
 * `leadsGenerated` are written by the metrics join, and a board where they can be typed
 * in is a board whose numbers mean nothing.
 */
export const contentPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  format: z.enum(FORMATS).optional(),
  publishDate: z.string().date().nullable().optional(),
  /** "09:30" from an <input type="time">, or null to clear the slot. */
  publishTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time looks like 09:30.')
    .nullable()
    .optional(),
  assetShape: z.string().trim().max(60).nullable().optional(),
  authorEmail: z.email().nullable().optional(),
  designerEmail: z.email().nullable().optional(),
  partnerVoice: z.string().trim().max(120).nullable().optional(),
  channelSlug: z.string().trim().max(60).nullable().optional(),
  brief: z.string().trim().max(MAX_BRIEF).nullable().optional(),
  url: z.string().trim().max(500).nullable().optional(),
  assetUrl: z.string().trim().max(500).nullable().optional(),
  targetKeyword: z.string().trim().max(200).nullable().optional(),
  topicCluster: z.enum(TOPIC_CLUSTERS).nullable().optional(),
  segment: z.enum(COMPANY_SEGMENTS).nullable().optional(),
  serviceLine: z.enum(SERVICE_LINES).nullable().optional(),
  campaignId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type ContentPatch = z.infer<typeof contentPatch>;

/**
 * Edits a piece, and records which fields changed.
 *
 * Until now a piece could be created and dragged between statuses and nothing else. A
 * calendar that cannot be corrected is a calendar that gets corrected in the spreadsheet
 * and re-uploaded, which is how the copy on screen stops being the one anybody trusts.
 *
 * Nothing here touches `approvedHash`. That is the point of the hash: §21.2 records the
 * exact version an approver read, and `approvalState` compares it against the piece as it
 * now stands — so an edit to a title or a brief makes a standing approval read as stale
 * on its own, and the publish gate refuses it, without this function having to know which
 * fields an approval covers. Clearing the approval here would be worse: it would erase the
 * fact that somebody approved something, which is the record §21.2 asks for.
 *
 * The audit detail carries only the field names, not the old and new values. A brief is up
 * to 4,000 characters and two of them per edit would make the log unreadable for the sake
 * of a diff nobody reads; the names answer "who changed what", which is the question.
 */
export async function updateContent(id: string, patch: ContentPatch, actorEmail: string) {
  const existing = await db().contentPiece.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!existing) return null;

  const { publishDate, publishTime, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (publishDate !== undefined) {
    // A date, or null to take the piece off the calendar without deleting it — which is
    // what happens to a post that is postponed and not yet re-planned.
    data.publishDate = publishDate === null ? null : new Date(publishDate);
  }
  if (publishTime !== undefined) {
    // The form sends a wall clock; the column holds minutes from midnight. Converted here
    // rather than in the browser so the one that reaches the database is the one shape.
    if (publishTime === null) data.publishMinute = null;
    else {
      const [hours, minutes] = publishTime.split(':').map(Number);
      data.publishMinute = hours * 60 + minutes;
    }
  }

  const changed = Object.keys(data);
  if (!changed.length) return { id, changed: [] as string[], unchanged: true };

  await db().contentPiece.update({ where: { id }, data });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'content.update',
      entityType: 'content_piece',
      entityId: id,
      // The title as it was, so the log still says which piece this was about after the
      // piece has been renamed twice.
      detail: { title: existing.title, fields: changed },
    },
  });

  return { id, changed, unchanged: false };
}

/**
 * The line under the approval label: who, when, and how long this has been waiting.
 *
 * The review age is shown on anything still unapproved, because that is the SLA clock
 * §21.2 asks to keep running — and it is the number that makes a returned piece
 * uncomfortable to leave alone.
 */
function approvalDetail(state: ApprovalState, ageHours: number | null): string | null {
  const waiting = ageHours === null ? null : `${Math.round(ageHours)}h in review`;
  if (state.state === 'approved' || state.state === 'stale') {
    return `${state.by.split('@')[0]} on ${state.at.toISOString().slice(0, 10)}`;
  }
  if (state.state === 'returned') {
    return [state.note, waiting].filter(Boolean).join(' · ') || null;
  }
  return waiting;
}

export async function contentBoard() {
  const pieces = await db().contentPiece.findMany({
    orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
    include: { campaign: { select: { id: true, name: true } } },
  });

  const published = pieces.filter((p) => p.status === 'published');
  const totals = {
    total: pieces.length,
    published: published.length,
    views: published.reduce((t, p) => t + p.views, 0),
    leads: published.reduce((t, p) => t + p.leadsGenerated, 0),
  };

  // Derived here rather than on the card: the card is a client component and the rule
  // for whether an approval still stands is a hash comparison over fields the card has
  // no reason to hold. It receives the conclusion.
  const now = new Date();
  const withApproval = pieces.map((p) => {
    const state = approvalState(p);
    const age = reviewAgeHours(p.reviewStartedAt, now);
    return {
      ...p,
      approval: {
        state: state.state,
        label: APPROVAL_LABELS[state.state],
        detail: approvalDetail(state, age),
      },
    };
  });

  return {
    pieces: withApproval,
    // Fixed order, not whatever the data happens to contain, so an empty stage still
    // shows as an empty column.
    columns: CONTENT_STATUSES.map((status) => ({
      status,
      pieces: withApproval.filter((p) => p.status === status),
    })),
    totals: { ...totals, leadsPerThousandViews: rate(totals.leads, totals.views / 1000) },
  };
}

/**
 * `actorEmail` is who added the row, which is not `input.authorEmail` — that is whose
 * voice the piece is written in, a property of the content. The two are often different
 * people and only one of them is a fact about the system.
 */
export async function createContent(input: ContentInput, actorEmail: string) {
  const piece = await db().contentPiece.create({
    data: { ...input, publishDate: input.publishDate ? new Date(input.publishDate) : null },
    select: { id: true },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'content.create',
      entityType: 'content_piece',
      entityId: piece.id,
      detail: { title: input.title, status: input.status, format: input.format },
    },
  });

  return piece;
}

/**
 * Moves a piece to a status and records who moved it.
 *
 * The record goes to `audit_event` rather than `activity`, which is where the equivalent
 * lead and deal transitions write: activity rows hang off a lead, contact, company or
 * opportunity, and a content piece is none of those. audit_event is already the generic
 * entityType/entityId log and needs no migration to accept one more kind of subject.
 *
 * A no-op move writes nothing. Publishing is reachable from any status and still is —
 * ordering the stages is §15.3 and a separate piece of work — but from here on, whoever
 * published something is on the record.
 */
/**
 * Whether a piece may move from one status to another. §15.3: "No item can skip a status."
 *
 * Forward one step, or backward any number. That asymmetry is the whole rule and it is
 * deliberate: skipping forward is how a proofread gets missed, and going back is what
 * happens every time a draft turns out to need more work. A workflow that only moves
 * forward is one people route around by editing the database.
 *
 * `archived` is reachable from anywhere and leads nowhere except back to where the piece
 * was — abandoning an item is not a stage, and an item resurrected from the archive
 * should re-enter the pipeline where it left it rather than at the beginning.
 */
export function canMoveTo(
  from: (typeof CONTENT_STATUSES)[number],
  to: (typeof CONTENT_STATUSES)[number],
): boolean {
  if (from === to) return true;
  if (to === 'archived') return true;
  // Out of the archive, anywhere: the board does not know where the piece was, so
  // refusing would strand it.
  if (from === 'archived') return true;

  const a = CONTENT_PIPELINE.indexOf(from as (typeof CONTENT_PIPELINE)[number]);
  const b = CONTENT_PIPELINE.indexOf(to as (typeof CONTENT_PIPELINE)[number]);
  if (a === -1 || b === -1) return false;
  return b <= a + 1;
}

export class WorkflowError extends Error {}

export async function setContentStatus(
  id: string,
  status: (typeof CONTENT_STATUSES)[number],
  actorEmail: string,
) {
  const existing = await db().contentPiece.findUnique({
    where: { id },
    select: {
      status: true,
      title: true,
      brief: true,
      url: true,
      format: true,
      channelSlug: true,
      approvedByEmail: true,
      approvedAt: true,
      approvedHash: true,
      returnedAt: true,
      returnedNote: true,
      reviewStartedAt: true,
    },
  });
  if (!existing) return null;
  if (existing.status === status) return { from: existing.status, to: status, unchanged: true };

  // §15.3's ordering, enforced here rather than in the board. The board drags cards and
  // nothing else sees the transition, which is the same argument the publish gate below
  // makes for living in this function.
  if (!canMoveTo(existing.status, status)) {
    throw new WorkflowError(
      `A piece cannot go straight from ${existing.status} to ${status}. Each step has to be recorded — that is what makes the technical check and the proofread two steps rather than one habit.`,
    );
  }

  // §21.2's gate. A piece may not be published without a live approval, and an approval
  // whose hash no longer matches the content is not live — somebody has edited the piece
  // since it was read, and the approval now vouches for words the approver never saw.
  //
  // Enforced here rather than in the route so it holds for every caller. It is the only
  // place in the application that can enforce it: the board drags cards between statuses
  // and nothing else sees the transition.
  if (status === 'published') {
    const state = approvalState(existing);
    if (!canPublish(state)) {
      throw new ApprovalError(
        state.state === 'stale'
          ? `This piece was edited after ${state.by} approved it, so it needs approving again.`
          : 'A piece needs an approval before it can be published.',
      );
    }
  }

  await db().contentPiece.update({
    where: { id },
    data: {
      status,
      // The SLA clock starts the first time a piece reaches review and is never restarted
      // — see reviewAgeHours. A piece returned and resubmitted keeps its original age,
      // which is the point: bouncing it back must not make it look new.
      reviewStartedAt:
        status === CONTENT_REVIEW_STATUS && !existing.reviewStartedAt ? new Date() : undefined,
    },
  });
  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'content.status',
      entityType: 'content_piece',
      entityId: id,
      // The title is copied in rather than joined at read time: a piece can be renamed
      // or deleted, and the log has to still say what was published.
      detail: { title: existing.title, from: existing.status, to: status },
    },
  });

  return { from: existing.status, to: status, unchanged: false };
}

// ── Approval ──────────────────────────────────────────────────────────────────────────
//
// §21.2. The approve path is gated on the `approve` permission at the route, which is the
// first thing in this application to check it: the permission has existed since roles
// were made assignable and nothing consulted it.

export class ApprovalError extends Error {}

const APPROVABLE = {
  title: true,
  brief: true,
  url: true,
  format: true,
  channelSlug: true,
} as const;

/**
 * Records an approval against the exact content that was approved.
 *
 * Refuses a piece that is not in review. Approving an idea or a published piece is not a
 * thing anybody means to do, and allowing it would let an approval be recorded against
 * something nobody was asked to read.
 */
export async function approveContent(id: string, actorEmail: string) {
  const piece = await db().contentPiece.findUnique({
    where: { id },
    select: { ...APPROVABLE, id: true, status: true, authorEmail: true },
  });
  if (!piece) return null;
  if (piece.status !== CONTENT_REVIEW_STATUS) {
    throw new ApprovalError(`Only a piece in review can be approved; this one is ${piece.status}.`);
  }

  const hash = contentHash(piece);
  await db().contentPiece.update({
    where: { id },
    data: {
      approvedByEmail: actorEmail,
      approvedAt: new Date(),
      approvedHash: hash,
      // A return is answered by the approval, so it no longer stands against the piece.
      // `reviewStartedAt` is left alone: it is when the clock started, not a status.
      returnedAt: null,
      returnedNote: null,
    },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'content.approve',
      entityType: 'content_piece',
      entityId: id,
      // The hash goes in the log as well as on the row. The row records the current
      // approval; the log records that this exact version was approved on this date, and
      // survives the row being approved again later.
      detail: { title: piece.title, hash },
    },
  });

  return { approved: true as const, hash };
}

/**
 * Sends a piece back to its author with the reason.
 *
 * The reason is required. §21.2's "Return quotes the finding back to the author" is the
 * whole value of a return — a piece that comes back with no explanation is a piece that
 * comes back to review unchanged.
 *
 * `authorEmail` has been stored on every piece since the table existed and was never
 * read by anything. This is what reads it.
 */
export async function returnContent(id: string, note: string, actorEmail: string) {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new ApprovalError('A return needs a reason — that is what the author acts on.');
  }

  const piece = await db().contentPiece.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, authorEmail: true },
  });
  if (!piece) return null;
  if (piece.status !== CONTENT_REVIEW_STATUS) {
    throw new ApprovalError(`Only a piece in review can be returned; this one is ${piece.status}.`);
  }

  await db().contentPiece.update({
    where: { id },
    data: {
      returnedAt: new Date(),
      returnedNote: trimmed,
      // Any earlier approval is void: the piece is going back for changes, and an
      // approval left on the row would be vouching for a draft somebody has been asked
      // to rewrite.
      approvedByEmail: null,
      approvedAt: null,
      approvedHash: null,
      // Back to draft, where its author can work on it. The clock keeps running —
      // reviewStartedAt is untouched — so the age of the item is still measured from
      // when it first arrived.
      status: 'draft',
    },
  });

  // The author is told. Without this the return is a note in a database that the one
  // person who has to act on it never sees.
  if (piece.authorEmail) {
    await db().notification.create({
      data: {
        title: `Returned: ${piece.title}`,
        body: trimmed,
        level: 'warning',
        href: '/content',
        forEmail: piece.authorEmail,
      },
    });
  }

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'content.return',
      entityType: 'content_piece',
      entityId: id,
      detail: { title: piece.title, note: trimmed, to: piece.authorEmail ?? 'no author on record' },
    },
  });

  return { returned: true as const, notifiedAuthor: piece.authorEmail !== null };
}
