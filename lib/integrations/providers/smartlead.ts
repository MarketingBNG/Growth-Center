import {
  IntegrationError,
  type IntegrationProvider,
  type MetricPoint,
  type SyncCursor,
} from '../types.ts';

// Smartlead — the cold-email platform the outreach runs on.
//
// An API key rather than OAuth: Smartlead issues one per workspace and it is passed as a
// query parameter on every call. Nothing here is user-scoped, so there is no consent flow
// to run and no token to refresh.
//
// The published reference documents the endpoints in prose rather than schemas, so every
// field below is read defensively — snake_case with fallbacks, numbers coerced, absences
// tolerated. A renamed field costs a blank column, never a failed sync.

const API = 'https://server.smartlead.ai/api/v1';

/** Smartlead's leads and statistics endpoints page with offset/limit. 100 is its
 *  documented maximum for these. */
const PAGE = 100;

type Stored = { apiKey: string };
type Json = Record<string, unknown>;

function url(path: string, apiKey: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ api_key: apiKey, ...params });
  return `${API}${path}?${q}`;
}

async function get(path: string, apiKey: string, params?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url(path, apiKey, params), { headers: { accept: 'application/json' } });

  if (res.status === 401 || res.status === 403) {
    throw new IntegrationError('Smartlead rejected the API key.');
  }
  // Nothing to return is a complete answer, not a failure.
  if (res.status === 204 || res.status === 404) return null;
  if (res.status === 429) {
    throw new IntegrationError('Smartlead is rate-limiting this sync. It will resume on the next run.');
  }
  if (!res.ok) throw new IntegrationError(`Smartlead request failed (${res.status}).`);

  return res.json();
}

/** Smartlead returns a bare array from some endpoints and `{ data: [...] }` from others. */
function rows(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload as Json[];
  if (payload && typeof payload === 'object') {
    const data = (payload as Json).data;
    if (Array.isArray(data)) return data as Json[];
  }
  return [];
}

const text = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** First of several field names to carry a value. Smartlead is inconsistent about
 *  `open_count` vs `unique_open_count` and similar across endpoints. */
function pick(row: Json, ...names: string[]): unknown {
  for (const n of names) if (row[n] != null) return row[n];
  return null;
}

/** Smartlead's campaign status onto the vocabulary Sequence.status already uses. */
export function sequenceStatus(value: string | null | undefined): string {
  const v = (value ?? '').toUpperCase();
  if (v === 'ACTIVE' || v === 'START') return 'active';
  if (v === 'PAUSED') return 'paused';
  if (v === 'COMPLETED' || v === 'STOPPED') return 'archived';
  return 'draft';
}

/**
 * Smartlead's per-lead state onto ProspectStatus.
 *
 * `engagement` wins over the campaign's own state when it is more specific: a lead marked
 * INPROGRESS that has actually replied is a reply, and showing it as merely active is the
 * difference between a person following up and not.
 */
export function prospectStatus(
  campaignState: string | null | undefined,
  engagement?: { replied?: boolean; bounced?: boolean; unsubscribed?: boolean },
): 'pending' | 'active' | 'replied' | 'bounced' | 'unsubscribed' | 'completed' {
  if (engagement?.unsubscribed) return 'unsubscribed';
  if (engagement?.bounced) return 'bounced';
  if (engagement?.replied) return 'replied';

  const v = (campaignState ?? '').toUpperCase();
  if (v === 'COMPLETED') return 'completed';
  if (v === 'INPROGRESS') return 'active';
  if (v === 'BLOCKED') return 'unsubscribed';
  return 'pending';
}

/**
 * Where a paged pull stopped.
 *
 * `ids` is carried rather than re-fetched so a resumed run does not re-list every campaign
 * to work out where it was, and so the set being walked cannot change underfoot when a
 * campaign is created mid-backfill.
 */
type Cursor = {
  ids: number[];
  index: number;
  stage: 'sequences' | 'leads' | 'stats';
  offset: number;
};

const STAGES: Cursor['stage'][] = ['sequences', 'leads', 'stats'];

export function readCursor(raw: unknown): Cursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Json;
  if (!Array.isArray(c.ids)) return null;

  const ids = c.ids.map(Number).filter((n) => Number.isFinite(n));
  const index = Number(c.index);
  const offset = Number(c.offset);
  const stage = STAGES.find((s) => s === c.stage);

  return {
    ids,
    index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
    stage: stage ?? 'sequences',
    offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0,
  };
}

export const smartlead: IntegrationProvider = {
  id: 'smartlead',
  name: 'Smartlead',
  category: 'email',
  authKind: 'apiKey',
  summary: 'Cold-email campaigns, the prospects in them and who replied.',
  provides: ['Campaigns', 'Sequence steps', 'Prospects', 'Replies', 'Bounces'],
  requiredEnv: [],
  docsUrl: 'https://api.smartlead.ai/reference/',

  // The key is supplied through the Integration Center rather than the environment, so
  // this provider is always ready to connect.
  isConfigured() {
    return true;
  },

  getAuthUrl() {
    return null;
  },

  async connect(input) {
    if (input.kind !== 'apiKey') throw new IntegrationError('Smartlead uses an API key.');

    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new IntegrationError('An API key is required.');

    // Validated against a real call rather than a format check: a key that looks right and
    // does not work would otherwise be stored and only fail on the first sync.
    const payload = await get('/campaigns/', apiKey);
    if (payload == null) throw new IntegrationError('Smartlead returned nothing for this key.');

    return { secret: JSON.stringify({ apiKey } satisfies Stored) };
  },

  async syncPaged(credential, _config, ctx) {
    const { apiKey } = JSON.parse(credential) as Stored;
    const points: MetricPoint[] = [];

    let cursor = readCursor(ctx.cursor);

    // A fresh pull starts by listing the campaigns and recording their stats. Those are
    // cheap and few, so they are all done in the first slice — which means the Outreach
    // page has real sequences on it after one pass, before the long walk through leads.
    if (!cursor) {
      const campaigns = rows(await get('/campaigns/', apiKey));
      const ids: number[] = [];

      for (const c of campaigns) {
        const id = text(c.id);
        if (!id) continue;
        ids.push(Number(id));

        points.push({
          entityType: 'outreach_sequence',
          entityId: id,
          metricKey: 'record',
          date: startOfDay(c.created_at),
          value: 1,
          entityLabel: text(c.name) ?? `Campaign ${id}`,
          entityMeta: { status: sequenceStatus(text(c.status)) },
        });
      }

      if (!ids.length) {
        throw new IntegrationError('Smartlead returned no campaigns for this key.');
      }

      // Per-campaign totals, one call each.
      for (const id of ids) {
        const a = (await get(`/campaigns/${id}/analytics`, apiKey)) as Json | null;
        if (!a) continue;

        const date = startOfDay(null);
        const totals: [string, unknown][] = [
          ['sent', pick(a, 'sent_count', 'unique_sent_count')],
          ['opened', pick(a, 'unique_open_count', 'open_count')],
          ['clicked', pick(a, 'unique_click_count', 'click_count')],
          ['replied', pick(a, 'reply_count')],
          ['bounced', pick(a, 'bounce_count')],
          ['unsubscribed', pick(a, 'unsubscribed_count')],
        ];
        for (const [metricKey, value] of totals) {
          if (value == null) continue;
          points.push({
            entityType: 'outreach_sequence',
            entityId: String(id),
            metricKey,
            date,
            value: num(value),
          });
        }

        if (Date.now() > ctx.deadline) break;
      }

      cursor = { ids, index: 0, stage: 'sequences', offset: 0 };
    }

    // Then the long part: each campaign's steps, its leads, and its per-lead engagement.
    while (cursor.index < cursor.ids.length) {
      const campaignId = cursor.ids[cursor.index];

      if (cursor.stage === 'sequences') {
        for (const step of rows(await get(`/campaigns/${campaignId}/sequences`, apiKey))) {
          const position = num(pick(step, 'seq_number', 'sequence_number'));
          if (!position) continue;

          const delay = pick(step, 'seq_delay_details');
          const waitDays =
            delay && typeof delay === 'object' ? num((delay as Json).delay_in_days) : num(pick(step, 'seq_delay'));

          points.push({
            entityType: 'outreach_step',
            entityId: `${campaignId}:${position}`,
            metricKey: 'record',
            date: startOfDay(null),
            value: 1,
            entityLabel: text(pick(step, 'subject')) ?? `Step ${position}`,
            entityMeta: {
              sequenceExternalId: String(campaignId),
              position,
              waitDays,
              subject: text(pick(step, 'subject')),
              body: text(pick(step, 'email_body', 'body')),
            },
          });
        }
        cursor = { ...cursor, stage: 'leads', offset: 0 };
      } else if (cursor.stage === 'leads') {
        const payload = await get(`/campaigns/${campaignId}/leads`, apiKey, {
          offset: String(cursor.offset),
          limit: String(PAGE),
        });
        const batch = rows(payload);

        for (const entry of batch) {
          // A lead arrives either flat or nested under `lead`, with the campaign-specific
          // state alongside it.
          const lead = (entry.lead && typeof entry.lead === 'object' ? entry.lead : entry) as Json;
          const id = text(lead.id) ?? text(entry.lead_id);
          const email = text(lead.email);
          if (!id || !email) continue;

          points.push({
            entityType: 'outreach_prospect',
            entityId: id,
            metricKey: 'record',
            date: startOfDay(lead.created_at),
            value: 1,
            entityLabel: [text(lead.first_name), text(lead.last_name)].filter(Boolean).join(' ') || email,
            entityMeta: {
              sequenceExternalId: String(campaignId),
              email,
              firstName: text(lead.first_name),
              lastName: text(lead.last_name),
              companyName: text(pick(lead, 'company_name', 'company')),
              status: prospectStatus(text(pick(entry, 'status', 'lead_status'))),
            },
          });
        }

        cursor =
          batch.length < PAGE
            ? { ...cursor, stage: 'stats', offset: 0 }
            : { ...cursor, offset: cursor.offset + PAGE };
      } else {
        const payload = await get(`/campaigns/${campaignId}/statistics`, apiKey, {
          offset: String(cursor.offset),
          limit: String(PAGE),
        });
        const batch = rows(payload);

        for (const stat of batch) {
          const email = text(pick(stat, 'lead_email', 'email'));
          if (!email) continue;

          points.push({
            entityType: 'outreach_engagement',
            // Keyed by campaign and address: the statistics rows carry the address rather
            // than the lead id, and an address is unique within a campaign.
            entityId: `${campaignId}:${email.toLowerCase()}`,
            metricKey: 'record',
            date: startOfDay(pick(stat, 'sent_time')),
            value: 1,
            entityMeta: {
              sequenceExternalId: String(campaignId),
              email,
              replied: !!pick(stat, 'reply_time', 'is_replied'),
              bounced: !!pick(stat, 'is_bounced'),
              unsubscribed: !!pick(stat, 'is_unsubscribed'),
            },
          });
        }

        if (batch.length < PAGE) {
          cursor = { ...cursor, index: cursor.index + 1, stage: 'sequences', offset: 0 };
        } else {
          cursor = { ...cursor, offset: cursor.offset + PAGE };
        }
      }

      if (Date.now() > ctx.deadline) return { points, cursor: cursor as unknown as SyncCursor };
    }

    return { points, cursor: null };
  },
};

/** Midnight UTC for the day a record belongs to. Stable across syncs, which is what keeps
 *  a metric point's unique key stable and makes a re-sync an update rather than a row. */
function startOfDay(value: unknown): Date {
  const raw = value == null ? '' : String(value);
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date(new Date().setUTCHours(0, 0, 0, 0));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
