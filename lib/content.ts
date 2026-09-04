import { z } from 'zod';
import { db } from './prisma.ts';
import { CONTENT_STATUSES } from './enums.ts';
import { rate } from './calc.ts';

export const contentInput = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(CONTENT_STATUSES).default('idea'),
  format: z.enum(['blog', 'video', 'social', 'email', 'landing_page', 'case_study']).default('blog'),
  authorEmail: z.string().trim().email().optional(),
  channelSlug: z.string().trim().max(60).optional(),
  campaignId: z.string().min(1).optional(),
  brief: z.string().trim().max(4000).optional(),
  url: z.string().trim().max(500).optional(),
  publishDate: z.string().date().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export type ContentInput = z.infer<typeof contentInput>;

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

  return {
    pieces,
    // Fixed order, not whatever the data happens to contain, so an empty stage still
    // shows as an empty column.
    columns: CONTENT_STATUSES.map((status) => ({
      status,
      pieces: pieces.filter((p) => p.status === status),
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
export async function setContentStatus(
  id: string,
  status: (typeof CONTENT_STATUSES)[number],
  actorEmail: string,
) {
  const existing = await db().contentPiece.findUnique({
    where: { id },
    select: { status: true, title: true },
  });
  if (!existing) return null;
  if (existing.status === status) return { from: existing.status, to: status, unchanged: true };

  await db().contentPiece.update({ where: { id }, data: { status } });
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
