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

  const reported = await reportedTotals(rows);

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
      /// Which system wrote the sequence, so the page can tell a real campaign from a
      /// seeded one. Null means the seeder or someone typing into the UI.
      source: s.source,
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
      /// What the sending platform says it did with this campaign. Null for a sequence
      /// this app owns, which has no external totals to report.
      sending: reported.get(s.id) ?? null,
      createdAt: s.createdAt,
    };
  });
}

export type SendingTotals = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  openRate: number | null;
};

/**
 * The per-campaign totals the sending platform reported, for every imported sequence.
 *
 * An imported campaign was sent by Smartlead, not from here, so there are no
 * OutreachMessage rows to count and the page could only ever say nothing was sent — while
 * the sync had already stored what each campaign actually delivered. This is the only
 * honest source of a send this app did not make.
 *
 * One query for every sequence rather than one each: fifty campaigns is fifty round trips
 * against Neon, which is most of a page load.
 */
async function reportedTotals(
  rows: { id: string; source: string | null; externalId: string | null }[],
): Promise<Map<string, SendingTotals>> {
  const imported = rows.filter((r) => r.source && r.externalId);
  if (!imported.length) return new Map();

  const snapshots = await db().metricSnapshot.findMany({
    where: {
      entityType: 'outreach_sequence',
      entityId: { in: imported.map((r) => r.externalId as string) },
      metricKey: { in: ['sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed'] },
    },
    select: { source: true, entityId: true, metricKey: true, value: true, date: true },
    orderBy: { date: 'desc' },
  });

  // Newest wins. These are running campaign totals restated on every sync, not daily
  // increments — summing them would multiply a campaign by the number of syncs it has
  // seen, which after a week of nightly runs is a sevenfold overstatement.
  const latest = new Map<string, number>();
  for (const r of snapshots) {
    const key = `${r.source}|${r.entityId}|${r.metricKey}`;
    if (!latest.has(key)) latest.set(key, Number(r.value));
  }

  const out = new Map<string, SendingTotals>();
  for (const r of imported) {
    const at = (k: string) => latest.get(`${r.source}|${r.externalId}|${k}`) ?? 0;
    const sent = at('sent');
    // A campaign the platform has not started yet reports nothing, and a row of zeroes
    // reads as a failure rather than as "not begun". Left off entirely instead.
    if (!sent) continue;
    out.set(r.id, {
      sent,
      opened: at('opened'),
      clicked: at('clicked'),
      replied: at('replied'),
      bounced: at('bounced'),
      unsubscribed: at('unsubscribed'),
      openRate: rate(at('opened'), sent),
    });
  }
  return out;
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
