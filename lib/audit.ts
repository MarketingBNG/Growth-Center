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
  'content.create': 'added a content piece',
  'content.status': 'moved a content piece',
  'insight.dismiss': 'dismissed a finding',
  'insight.restore': 'restored a finding',
  'integration.configure': 'reconfigured an integration',
  'integration.connect': 'connected an integration',
  'integration.disconnect': 'disconnected an integration',
  'settings.attribution': 'changed the attribution threshold',
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

/** The most recent entries, newest first. Indexed on createdAt. */
export async function recentAuditEvents(limit = 50): Promise<AuditRow[]> {
  return db().auditEvent.findMany({
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
  });
}
