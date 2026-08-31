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

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/**
 * A step body as readable text.
 *
 * Smartlead stores the composed email, which is HTML — 120 of the 121 imported steps are
 * markup, one of them 33KB of it. Rendered as text that printed
 * `<div><strong style="font-weight: 700">` down the card, and the page shipped 2.7MB of
 * escaped tags for a preview nobody could read. Tags become spacing, entities become
 * characters, and the result is trimmed, because a card is not an email client.
 */
export function preview(html: string, max = 500): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Block ends are the only line breaks worth keeping; everything else collapses.
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? ENTITIES[e] ?? m)
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    // Blank lines dropped, not kept: the card shows the first few lines of the step, and
    // an empty one spends a line of that budget on nothing.
    .filter((l) => l)
    .join('\n');
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export async function sequences() {
  // Counted in the database, not in memory. Including the prospects to tally them by
  // status pulled all 23,687 rows into the page on every view, to produce five numbers
  // per sequence.
  const [rows, statusCounts] = await Promise.all([
    db().sequence.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        steps: { orderBy: { position: 'asc' } },
        _count: { select: { prospects: true } },
      },
    }),
    db().prospect.groupBy({ by: ['sequenceId', 'status'], _count: { _all: true } }),
  ]);

  const statusBySequence = new Map<string, Record<string, number>>();
  for (const row of statusCounts) {
    const entry = statusBySequence.get(row.sequenceId) ?? {};
    entry[row.status] = row._count._all;
    statusBySequence.set(row.sequenceId, entry);
  }

  const reported = await reportedTotals(rows);

  return rows.map((s) => {
    const byStatus = statusBySequence.get(s.id) ?? {};
    const replied = byStatus.replied ?? 0;
    const sending = reported.get(s.id) ?? null;
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
        subject: st.subject?.trim() || null,
        body: preview(st.body),
      })),
      prospects: s._count.prospects,
      byStatus,
      /// Against what the platform says it sent, whenever it says anything. The imported
      /// prospect rows are a partial copy of the campaign's list — 220 rows for a
      /// campaign Smartlead sent 700 times — so dividing by them put "10.0% reply rate"
      /// in the header above tiles reading 66 replies of 700, and "0.00% reply rate"
      /// above a tile reading 5. Null, not zero, when there is no denominator either way.
      replyRate: sending ? rate(sending.replied, sending.sent) : rate(replied, s._count.prospects),
      /// What the sending platform says it did with this campaign. Null for a sequence
      /// this app owns, which has no external totals to report.
      sending,
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

