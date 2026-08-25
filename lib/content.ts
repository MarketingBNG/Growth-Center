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

export async function createContent(input: ContentInput) {
  return db().contentPiece.create({
    data: { ...input, publishDate: input.publishDate ? new Date(input.publishDate) : null },
    select: { id: true },
  });
}

export async function setContentStatus(id: string, status: (typeof CONTENT_STATUSES)[number]) {
  const existing = await db().contentPiece.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return null;
  await db().contentPiece.update({ where: { id }, data: { status } });
  return { from: existing.status, to: status };
}
