import { db } from '../../platform/prisma.ts';
import { prospectStatus as prospectStatusOf } from '../providers/smartlead.ts';
import type { MetricPoint } from '../types.ts';
import { bulkUpsert, importedEmail, meta, str } from '../persist.ts';

/**
 * Turns `outreach_sequence`, `outreach_step`, `outreach_prospect` and
 * `outreach_engagement` points into real Sequence, SequenceStep and Prospect rows.
 *
 * The Outreach page reads those three tables and nothing else — it has never read
 * metric_snapshot — so without this a mail provider could sync perfectly and the page
 * would still show only the seeder's three invented sequences.
 *
 * Rows match on (source, externalId), so a re-sync updates in place.
 */
export async function writeOutreach(providerId: string, points: MetricPoint[]): Promise<number> {
  const sequencePoints = points.filter((p) => p.entityType === 'outreach_sequence' && p.entityId);
  const stepPoints = points.filter((p) => p.entityType === 'outreach_step' && p.entityId);
  const prospectPoints = points.filter((p) => p.entityType === 'outreach_prospect' && p.entityId);
  const engagementPoints = points.filter((p) => p.entityType === 'outreach_engagement' && p.entityId);

  if (!sequencePoints.length && !stepPoints.length && !prospectPoints.length && !engagementPoints.length) {
    return 0;
  }

  let written = 0;

  // ── sequences ───────────────────────────────────────────────────────────────
  // Only the `record` points carry a name; the rest are the campaign's totals, which
  // belong in metric_snapshot and have no column on Sequence.
  const sequenceRows = sequencePoints
    .filter((p) => p.metricKey === 'record')
    .map((p) => [p.entityLabel ?? (p.entityId as string), str(meta(p).status) ?? 'draft', providerId, p.entityId]);

  const sequences = await bulkUpsert(
    'sequence',
    ['name', 'status', 'source', 'externalId'],
    sequenceRows,
    '"source", "externalId"',
  );
  const sequenceIdByExternal = new Map(sequences.map((r) => [r.externalId ?? '', r.id]));
  written += sequences.length;

  // A slice that carries prospects but not their sequence — the pull resumed mid-campaign
  // — still needs the sequence's id to hang them off.
  const referenced = new Set(
    [...stepPoints, ...prospectPoints, ...engagementPoints]
      .map((p) => str(meta(p).sequenceExternalId))
      .filter((v): v is string => !!v && !sequenceIdByExternal.has(v)),
  );
  if (referenced.size) {
    const known = await db().sequence.findMany({
      where: { source: providerId, externalId: { in: [...referenced] } },
      select: { id: true, externalId: true },
    });
    for (const s of known) if (s.externalId) sequenceIdByExternal.set(s.externalId, s.id);
  }

  // ── steps ───────────────────────────────────────────────────────────────────
  // SequenceStep is keyed on (sequenceId, position), which is the platform's own notion of
  // a step, so no externalId of its own is needed.
  const stepRows: unknown[][] = [];
  for (const p of stepPoints) {
    const sequenceId = sequenceIdByExternal.get(str(meta(p).sequenceExternalId) ?? '');
    if (!sequenceId) continue;

    const m = meta(p);
    stepRows.push([
      sequenceId,
      Number(m.position) || 1,
      Number(m.waitDays) || 0,
      str(m.subject) ?? '',
      str(m.body) ?? '',
      'email',
    ]);
  }
  const steps = await bulkUpsert(
    'sequence_step',
    ['sequenceId', 'position', 'waitDays', 'subject', 'body', 'channel'],
    stepRows,
    '"sequenceId", "position"',
    { position: 'int', waitDays: 'int' },
    false,
  );
  written += steps.length;

  // ── prospects ───────────────────────────────────────────────────────────────
  // Prospect carries a second unique key, (sequenceId, email), which a bulk insert cannot
  // negotiate at the same time as (source, externalId): a lead whose address is already in
  // the sequence under a different id would abort the batch on the wrong index. Those are
  // resolved first, and are rare.
  const prospectRows: unknown[][] = [];
  const collisions: { id: string; data: Record<string, unknown> }[] = [];

  if (prospectPoints.length) {
    const wanted = prospectPoints
      .map((p) => {
        const sequenceId = sequenceIdByExternal.get(str(meta(p).sequenceExternalId) ?? '');
        // Lower-cased for the same reason contacts are, and it has to match: replies and
        // bounces arrive from a separate endpoint keyed on the address, so a prospect
        // stored in the CRM's casing would never be matched to its own engagement.
        const email = importedEmail(meta(p).email);
        return sequenceId && email ? { p, sequenceId, email } : null;
      })
      .filter((v): v is { p: MetricPoint; sequenceId: string; email: string } => !!v);

    // One OR branch per prospect, and Postgres caps a statement at 65,535 bind
    // parameters — a campaign of a few thousand leads blew straight past it. Looked up
    // in slices so the batch size, not the campaign size, decides the parameter count.
    const LOOKUP_CHUNK = 1000;
    const existing: { id: string; sequenceId: string; email: string; source: string | null; externalId: string | null }[] = [];
    for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
      const slice = wanted.slice(i, i + LOOKUP_CHUNK);
      existing.push(
        ...(await db().prospect.findMany({
          where: { OR: slice.map((w) => ({ sequenceId: w.sequenceId, email: w.email })) },
          select: { id: true, sequenceId: true, email: true, source: true, externalId: true },
        })),
      );
    }
    const byPair = new Map(existing.map((r) => [`${r.sequenceId}|${r.email}`, r]));

    for (const { p, sequenceId, email } of wanted) {
      const m = meta(p);
      const externalId = p.entityId as string;
      const data = {
        sequenceId,
        email,
        firstName: str(m.firstName),
        lastName: str(m.lastName),
        companyName: str(m.companyName),
        status: prospectStatusOf(str(m.status)),
      };

      const clash = byPair.get(`${sequenceId}|${email}`);
      const alreadyOurs = clash?.source === providerId && clash?.externalId === externalId;

      if (clash && !alreadyOurs) {
        collisions.push({ id: clash.id, data: { ...data, source: providerId, externalId } });
      } else {
        prospectRows.push([
          data.sequenceId,
          data.email,
          data.firstName,
          data.lastName,
          data.companyName,
          data.status,
          providerId,
          externalId,
        ]);
      }
    }
  }

  for (const c of collisions) {
    await db().prospect.update({ where: { id: c.id }, data: c.data });
    written++;
  }

  const prospects = await bulkUpsert(
    'prospect',
    ['sequenceId', 'email', 'firstName', 'lastName', 'companyName', 'status', 'source', 'externalId'],
    prospectRows,
    '"source", "externalId"',
    { status: '"ProspectStatus"' },
  );
  written += prospects.length;

  // Outreach and the CRM are two lists of the same people, and nothing joined them: every
  // prospect sat with a null contact, so a reply in a campaign told you nothing about the
  // company it came from. Matched on address, which is the only identifier both systems
  // agree on.
  //
  // Set once and left alone — a contact deliberately reassigned here should not be undone
  // by the next sync.
  await db().$executeRawUnsafe(
    `UPDATE prospect p
     SET "contactId" = c.id
     FROM contact c
     WHERE p.source = $1
       AND p."contactId" IS NULL
       AND p.email IS NOT NULL
       AND lower(c.email) = lower(p.email)`,
    providerId,
  );

  // ── engagement ──────────────────────────────────────────────────────────────
  // Replies and bounces arrive from a different endpoint, keyed by address rather than by
  // lead id, so they are applied as a status upgrade on top of the prospects above.
  for (const p of engagementPoints) {
    const m = meta(p);
    const sequenceId = sequenceIdByExternal.get(str(m.sequenceExternalId) ?? '');
    const email = importedEmail(m.email);
    if (!sequenceId || !email) continue;

    const status = prospectStatusOf(null, {
      replied: !!m.replied,
      bounced: !!m.bounced,
      unsubscribed: !!m.unsubscribed,
    });
    // Nothing happened to this lead worth overriding the campaign's own state with.
    if (status === 'pending') continue;

    const updated = await db().prospect.updateMany({
      where: { sequenceId, email },
      data: { status },
    });
    written += updated.count;
  }

  return written;
}
