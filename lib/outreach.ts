import { z } from 'zod';
import { db } from './prisma.ts';
import { rate } from './calc.ts';

export const sequenceInput = z.object({
  name: z.string().trim().min(1).max(160),
  ownerEmail: z.string().trim().email().optional(),
});

export const stepInput = z.object({
  sequenceId: z.string().min(1),
  waitDays: z.number().int().min(0).max(90).default(0),
  channel: z.enum(['email', 'linkedin', 'call']).default('email'),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(8000),
});

export async function sequences() {
  const rows = await db().sequence.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      steps: { orderBy: { position: 'asc' } },
      prospects: { select: { status: true } },
      _count: { select: { prospects: true } },
    },
  });

  return rows.map((s) => {
    const byStatus = s.prospects.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});
    const replied = byStatus.replied ?? 0;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      ownerEmail: s.ownerEmail,
      steps: s.steps.map((st) => ({
        id: st.id,
        position: st.position,
        waitDays: st.waitDays,
        channel: st.channel,
        subject: st.subject,
        body: st.body,
      })),
      prospects: s._count.prospects,
      byStatus,
      replyRate: rate(replied, s._count.prospects),
      createdAt: s.createdAt,
    };
  });
}

export async function sequenceDetail(id: string) {
  const sequence = await db().sequence.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { position: 'asc' } },
      prospects: {
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { orderBy: { sentAt: 'desc' }, take: 1 },
          contact: { select: { id: true } },
        },
      },
    },
  });
  if (!sequence) return null;

  const messages = await db().outreachMessage.findMany({
    where: { prospect: { sequenceId: id } },
    select: { status: true, openedAt: true, repliedAt: true, providerId: true },
  });

  const sent = messages.length;
  return {
    sequence,
    stats: {
      sent,
      opened: messages.filter((m) => m.openedAt).length,
      replied: messages.filter((m) => m.repliedAt).length,
      openRate: rate(messages.filter((m) => m.openedAt).length, sent),
      replyRate: rate(messages.filter((m) => m.repliedAt).length, sent),
      // Whether anything actually left the building. The console provider records a
      // send without sending, and the card must say so.
      providers: [...new Set(messages.map((m) => m.providerId).filter(Boolean))] as string[],
    },
  };
}
