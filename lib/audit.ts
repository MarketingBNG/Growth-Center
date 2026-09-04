// Reading the audit log.
//
// The writes have been there a while — connecting an integration, minting a key, moving a
// content piece — but nothing ever read them back, so "who did that" was a question the
// database could answer and the product could not. This is the read side.
//
// Server-only: imports Prisma. The phrasing helpers below are pure and framework-free so
// tools/audit.test.ts can import them directly.

import { db } from './prisma.ts';

export type AuditRow = {
  id: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
  createdAt: Date;
};

/**
 * How each action reads in a sentence, in the past tense, with the subject supplied by
 * the actor column beside it.
 *
 * An action with no entry here falls back to its own string rather than being hidden or
 * relabelled — an unrecognised action is exactly the row someone is most likely to be
 * looking for, and a log that quietly drops what it does not understand is worse than no
 * log at all.
 */
const PHRASING: Record<string, string> = {
  'apikey.create': 'issued an API key',
  'apikey.revoke': 'revoked an API key',
  'content.approve': 'approved a content piece',
  'content.create': 'added a content piece',
  'content.return': 'returned a content piece to its author',
  'content.status': 'moved a content piece',
  'insight.dismiss': 'dismissed a finding',
  'insight.restore': 'restored a finding',
  'insight.status': 'moved a finding',
  'integration.configure': 'reconfigured an integration',
  'leads.rebalance': 'rebalanced the lead queue',
  'record.converted': 'converted a lead',
  'record.note_added': 'added a note',
  'record.owner_changed': 'reassigned a record',
  'record.stage_changed': 'moved a deal',
  'record.status_changed': 'changed a status',
  'record.task_completed': 'completed a task',
  'integration.connect': 'connected an integration',
  'integration.disconnect': 'disconnected an integration',
  'settings.threshold': 'changed a threshold',
  'settings.currency': 'changed the reporting currency',
  'user.activate': 'restored access',
  'user.deactivate': 'revoked access',
  'user.rename': 'renamed someone',
  'user.role': 'changed a role',
};

export function phraseAction(action: string): string {
  return PHRASING[action] ?? action;
}

/**
 * The one-line "what changed" beside the sentence, read out of the detail JSON.
 *
 * Deliberately generic rather than a switch per action: detail shapes are written by a
 * dozen call sites and will keep being added to, and a formatter that knows all of them
 * is a formatter that silently prints nothing the first time one changes. It looks for
 * the handful of keys those call sites actually use, then falls back to the keys present.
 */
export function summariseDetail(detail: unknown): string {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return '';
  const d = detail as Record<string, unknown>;

  const subject = [d.title, d.name, d.email].find((v) => typeof v === 'string' && v) as
    | string
    | undefined;

  const parts: string[] = [];
  if (subject) parts.push(subject);

  // from/to is the commonest shape: a status move, a role change, a rename.
  if (d.from !== undefined || d.to !== undefined) {
    parts.push(`${format(d.from) || '—'} → ${format(d.to) || '—'}`);
  } else if (typeof d.role === 'string') {
    parts.push(d.role);
  } else if (typeof d.status === 'string') {
    parts.push(d.status);
  }

  if (parts.length) return parts.join(' · ');

  // Nothing recognised: name the keys, so the row still says something was recorded.
  const keys = Object.keys(d);
  return keys.length ? keys.join(', ') : '';
}

/**
 * What the Detail column shows: the detail JSON where there is one, and otherwise the
 * subject itself.
 *
 * The fallback is load-bearing rather than cosmetic. The integration rows — the bulk of
 * the log on this workspace — carry no detail at all, and their entityId is the provider
 * slug, so without this every connect and disconnect in the firm's history reads
 * "connected an integration · —" and the log cannot answer which one.
 */
export function describeRow(row: Pick<AuditRow, 'detail' | 'entityId'>): string {
  return summariseDetail(row.detail) || row.entityId || '';
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * The most recent entries, newest first — from BOTH tables.
 *
 * `auditEvent` records administrative acts: a role change, a key, a threshold, a
 * rebalance. Changes to records — a lead's status, a deal's stage, a task ticked off —
 * were never written there, and the first instinct was to start writing them. That would
 * have been wrong: they are already recorded, as `activity` rows carrying the actor, the
 * from and the to, attached to the record they describe. Two tables recording one fact is
 * this repository's documented failure mode, and the duplicate would have drifted.
 *
 * So the gap was never the writes. It was that this reader could only see one of the two,
 * and a log that shows who changed a threshold but not who reassigned two thousand leads
 * is not an activity log. They are merged here, at read time, and the merge is the only
 * place that knows about both.
 *
 * Fetched `limit` from each and then trimmed: taking 25 from each would show a quiet
 * fortnight of settings changes beside this morning's record edits, which is not what
 * "the last fifty things that happened" means.
 */
export async function recentAuditEvents(limit = 50): Promise<AuditRow[]> {
  const [events, activity] = await Promise.all([
    db().auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        actorEmail: true,
        action: true,
        entityType: true,
        entityId: true,
        detail: true,
        createdAt: true,
      },
    }),
    // Only rows with an actor. The sync writes `activity` too — 25,156 rows of imported
    // lead history — and none of it is somebody in this workspace doing something. An
    // activity log filled with the nightly import is a log nobody reads.
    db().activity.findMany({
      where: { actorEmail: { not: null }, source: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        actorEmail: true,
        type: true,
        summary: true,
        detail: true,
        createdAt: true,
        leadId: true,
        contactId: true,
        companyId: true,
        opportunityId: true,
      },
    }),
  ]);

  const fromActivity: AuditRow[] = activity.map((a) => ({
    id: a.id,
    actorEmail: a.actorEmail!,
    // Prefixed so the phrasing map cannot collide with an auditEvent action of the same
    // name, and so an unrecognised one still reads as a record change rather than as a
    // setting change.
    action: `record.${a.type}`,
    entityType: a.opportunityId
      ? 'opportunity'
      : a.leadId
        ? 'lead'
        : a.companyId
          ? 'company'
          : a.contactId
            ? 'contact'
            : 'record',
    entityId: a.opportunityId ?? a.leadId ?? a.companyId ?? a.contactId ?? null,
    // The summary is better than anything summariseDetail could build from the JSON —
    // "Status changed from new to contacted" is already the sentence — so it is used as
    // the detail directly.
    detail: a.detail ?? { name: a.summary },
    createdAt: a.createdAt,
  }));

  return [...events, ...fromActivity]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
