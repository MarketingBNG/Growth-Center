import { z } from 'zod';
import { db } from './prisma.ts';
import { rate } from './calc.ts';
import { slice, type ListQuery } from './list-query.ts';
import { preview } from './html-text.ts';
import { blocksSending, lintSequence, summarise } from './outreach-lint.ts';
import {
  SEQUENCE_PURPOSES,
  displayStatus,
  fitness,
  purposeLabel,
  templateHash,
} from './outreach-approval.ts';

// An unrecognised value drops its filter rather than throwing. These come straight from
// the query string, and `?status=bogus` is a typo in a shared link, not a reason to
// replace the page with an error boundary — the same rule pageQuery already applies.
export const sequenceFilters = z.object({
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional().catch(undefined),
  source: z.string().trim().max(40).optional().catch(undefined),
});

export type SequenceFilters = z.infer<typeof sequenceFilters>;

export const SEQUENCE_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;

/**
 * One page of sequences, each with its steps and its counts.
 *
 * Paged because the page renders whole campaigns, not table rows: fifty of them with
 * every step expanded was a single 24,000-pixel scroll, and it grew by a screenful with
 * each campaign imported.
 */
export async function sequences(filters: SequenceFilters, q: ListQuery) {
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    db().sequence.count({ where }),
    db().sequence.findMany({
      where,
      // `id` breaks the tie, and it has to: the Smartlead import stamps every campaign
      // with the same createdAt, so ordering on that alone leaves the database free to
      // return them in a different order per query — which pages that repeat one
      // sequence and never show another.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...slice(q),
      include: {
        steps: { orderBy: { position: 'asc' } },
        _count: { select: { prospects: true } },
      },
    }),
  ]);

  // Counted in the database, not in memory. Including the prospects to tally them by
  // status pulled all 23,687 rows into the page on every view, to produce five numbers
  // per sequence. Scoped to the page's sequences, so the tally does not walk the whole
  // table to describe ten campaigns.
  const ids = rows.map((r) => r.id);
  const statusCounts = ids.length
    ? await db().prospect.groupBy({
        by: ['sequenceId', 'status'],
        where: { sequenceId: { in: ids } },
        _count: { _all: true },
      })
    : [];

  const statusBySequence = new Map<string, Record<string, number>>();
  for (const row of statusCounts) {
    const entry = statusBySequence.get(row.sequenceId) ?? {};
    entry[row.status] = row._count._all;
    statusBySequence.set(row.sequenceId, entry);
  }

  const reported = await reportedTotals(rows);

  const list = rows.map((s) => {
    const byStatus = statusBySequence.get(s.id) ?? {};
    const replied = byStatus.replied ?? 0;
    const sending = reported.get(s.id) ?? null;

    // Linted from the stored body, before `preview` truncates it — a placeholder 600
    // characters into a step is exactly the one nobody has read.
    const hashable = s.steps.map((st) => ({
      position: st.position,
      subject: st.subject,
      body: st.body,
    }));
    const lint = summarise(lintSequence(hashable));
    const fit = fitness(s, hashable, lint.findings);

    return {
      id: s.id,
      name: s.name,
      /// What the sending platform says, qualified where the app cannot vouch for it:
      /// an active sequence nobody has approved reads "active · unapproved".
      status: displayStatus(s.status, fit),
      platformStatus: s.status,
      /// The registry (§14.2) and what it adds up to.
      registry: {
        purpose: s.purpose,
        purposeLabel: purposeLabel(s.purpose),
        segment: s.segment,
        serviceLine: s.serviceLine,
        sendingDomain: s.sendingDomain,
      },
      fit,
      /// Deterministic template checks (§14.6). Rendered per step and summarised on the
      /// header, so a template nobody should send says so on the screen rather than in
      /// somebody's memory.
      lint,
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

  return { rows: list, total, page: q.page, perPage: q.perPage };
}

export const registryInput = z.object({
  purpose: z.enum(SEQUENCE_PURPOSES).nullable().optional(),
  segment: z.string().trim().max(80).nullable().optional(),
  serviceLine: z.string().trim().max(80).nullable().optional(),
  sendingDomain: z.string().trim().max(120).nullable().optional(),
});

export type RegistryInput = z.infer<typeof registryInput>;

/** The registry fields. Descriptive only — none of these gates anything. */
export async function setSequenceRegistry(id: string, input: RegistryInput, actorEmail: string) {
  const before = await db().sequence.findUnique({ where: { id }, select: { name: true } });
  if (!before) return null;

  await db().sequence.update({ where: { id }, data: input });
  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'sequence.registry',
      entityType: 'sequence',
      entityId: id,
      detail: { name: before.name, ...input },
    },
  });
  return { ok: true };
}

export type SignOffKind = 'copy' | 'numbers';

/**
 * Signs off a template, or withdraws a sign-off.
 *
 * The hash of the steps as they stand is stored with the signature. That is what makes
 * this an approval of something rather than of a row: if the copy is edited afterwards,
 * or re-synced from Smartlead with different text, the stored hash stops matching and the
 * approval reports as stale instead of silently standing over words nobody has read.
 *
 * Refuses to sign a template the linter has blocked. Approving around a placeholder is
 * precisely the habit §14.6 exists to break, and letting the button do it would make the
 * linter advisory.
 */
export async function signOffSequence(
  id: string,
  kind: SignOffKind,
  granted: boolean,
  actorEmail: string,
) {
  const seq = await db().sequence.findUnique({
    where: { id },
    select: { name: true, steps: { select: { position: true, subject: true, body: true } } },
  });
  if (!seq) return null;

  if (granted) {
    const findings = lintSequence(seq.steps);
    if (blocksSending(findings)) {
      throw new IneligibleError(
        'This template has unresolved placeholders. Fix those before signing it off.',
      );
    }
  }

  const hash = granted ? templateHash(seq.steps) : null;
  const stamp = granted ? new Date() : null;
  const who = granted ? actorEmail : null;

  await db().sequence.update({
    where: { id },
    data:
      kind === 'copy'
        ? { copyApprovedByEmail: who, copyApprovedAt: stamp, copyApprovedHash: hash }
        : { numbersVerifiedByEmail: who, numbersVerifiedAt: stamp, numbersVerifiedHash: hash },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: granted ? `sequence.${kind}_signed` : `sequence.${kind}_withdrawn`,
      entityType: 'sequence',
      entityId: id,
      // The hash goes in the record too, so the log says which version was signed.
      detail: { name: seq.name, kind, templateHash: hash },
    },
  });

  return { ok: true };
}

/** A refusal the caller should show the user, not a bug. */
export class IneligibleError extends Error {}

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

