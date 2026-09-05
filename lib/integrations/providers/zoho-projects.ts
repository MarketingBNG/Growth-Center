import {
  httpTimeout,
  IntegrationError,
  type IntegrationProvider,
  type MetricPoint,
  type SyncCursor,
} from '../types.ts';

// Zoho Projects — where the firm's work is actually tracked.
//
// §21 asks a finding to become an assigned task. Growth Center can already assign one to
// an owner, but a task written only here exists nowhere anybody works, so the read comes
// before any write: until this application can show the real queue, a task it created
// would be invisible to the person meant to do it.
//
// **This is a different Zoho product from the CRM, and deliberately a different OAuth
// client.** Zoho fixes scope at authorisation, so adding Projects scopes to the CRM's
// client would require re-authorising the CRM — which revokes production's refresh token
// and stops the nightly sync. Hence ZOHO_PROJECTS_CLIENT_ID rather than ZOHO_CLIENT_ID.
// The two connections are independent and neither can break the other.

/** The data centre. Shared with the CRM because it is a property of the Zoho account, not
 *  of the product: this org lives on `.in`, and `.com` cannot see it at all. */
const DC = (process.env.ZOHO_DC ?? 'in').replace(/[^a-z.]/gi, '').toLowerCase() || 'in';

const ACCOUNTS = `https://accounts.zoho.${DC}`;
const API = `https://projectsapi.zoho.${DC}/api/v3`;

/**
 * Read-only, and only the three things this provider reads.
 *
 * No UPDATE or CREATE scope: §20.1's third principle is that the agent cannot act on the
 * world, and the strongest place to enforce that is the grant itself rather than a check
 * in application code. Writing tasks back is a later decision that needs its own consent.
 */
const SCOPE = 'ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.tasks.READ';

/** Zoho Projects caps per_page at 200 for tasks. */
const PER_PAGE = 200;

/** A backstop against a portal that never stops claiming another page. 200 pages is
 *  40,000 tasks, far above this portal's 521. */
const MAX_PAGES = 200;

type Stored = { refreshToken: string };
type Json = Record<string, unknown>;

async function accessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.ZOHO_PROJECTS_CLIENT_ID ?? '',
    client_secret: process.env.ZOHO_PROJECTS_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST', signal: httpTimeout() });
  if (!res.ok) throw new IntegrationError(`Zoho Projects token refresh failed (${res.status}).`);

  const json = (await res.json()) as { access_token?: string; error?: string };
  if (json.error) throw new IntegrationError(`Zoho Projects: ${json.error}`);
  if (!json.access_token) throw new IntegrationError('Zoho Projects returned no access token.');
  return json.access_token;
}

/**
 * Zoho Projects v3 answers in two different shapes and this is the trap in the whole file.
 *
 * `/portals` returns a **bare array**. `/portal/{id}/tasks` returns `{page_info, tasks}`
 * at the top level. Neither is wrapped in `data`, though the MCP connector that was used
 * to design this mapping presents them as `{data: {result: […]}}` and `{data: {tasks:
 * […]}}` — its own envelope, not the API's.
 *
 * Written against the connector's shape, every read returned undefined, the sync wrote
 * nothing and reported success. Both shapes are accepted here so the provider is correct
 * whichever it meets, and so this cannot regress quietly.
 */
function unwrap(payload: unknown, key: 'result' | 'tasks'): Json[] {
  if (Array.isArray(payload)) return payload as Json[];
  if (!payload || typeof payload !== 'object') return [];

  const top = payload as Json;
  if (Array.isArray(top[key])) return top[key] as Json[];

  const data = top.data;
  if (Array.isArray(data)) return data as Json[];
  if (data && typeof data === 'object') {
    const inner = (data as Json)[key];
    if (Array.isArray(inner)) return inner as Json[];
  }
  return [];
}

/** `page_info`, wherever this endpoint decided to put it. */
function pageInfo(payload: unknown): Json {
  if (!payload || typeof payload !== 'object') return {};
  const top = payload as Json;
  if (top.page_info && typeof top.page_info === 'object') return top.page_info as Json;
  const data = top.data as Json | undefined;
  if (data?.page_info && typeof data.page_info === 'object') return data.page_info as Json;
  return {};
}

async function get(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const q = new URLSearchParams(params);
  const url = `${API}${path}${q.toString() ? `?${q}` : ''}`;
  const res = await fetch(url, {
    headers: { authorization: `Zoho-oauthtoken ${token}`, accept: 'application/json' },
    signal: httpTimeout(),
  });

  if (res.status === 401) {
    throw new IntegrationError('Zoho Projects rejected the token. Reconnect the integration.');
  }
  // Zoho's own word for "authorised, but not for this". Reconnecting is the fix, so the
  // message says so rather than reporting a bare 403.
  if (res.status === 403) {
    throw new IntegrationError(
      'Zoho Projects refused the request for lack of scope. Reconnect the integration to grant it.',
    );
  }
  if (!res.ok) throw new IntegrationError(`Zoho Projects request failed (${res.status}).`);

  return (await res.json()) as Json;
}

const str = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

/** Zoho returns ISO instants for these. An unparseable one is absent, never epoch zero. */
function date(value: unknown): Date | null {
  const raw = str(value);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A task's status, onto this schema's TaskStatus.
 *
 * Keyed on **`is_closed_type`**, not on the status name, and that is the whole point.
 * Projects lets every project layout define its own statuses and rename them; this portal
 * happens to use Open / In Progress / Completed today, and a renamed or added status
 * would fall through a name match and silently land every task in `open`. The boolean is
 * Zoho's own answer to "does this status mean finished", so it cannot drift.
 *
 * The name is still read, but only to separate `in_progress` from `open` among the
 * statuses Zoho considers unfinished — a distinction Zoho does not otherwise expose.
 *
 * Nothing maps to `cancelled`: Projects has no cancelled concept, and inventing one from
 * a name would be exactly the guess this comment exists to prevent.
 */
export function taskStatus(status: unknown): 'open' | 'in_progress' | 'done' {
  const s = (status ?? {}) as Json;
  if (s.is_closed_type === true) return 'done';

  const name = (str(s.name) ?? '').toLowerCase();
  if (name.includes('progress')) return 'in_progress';
  return 'open';
}

/**
 * Projects' priority onto this schema's Priority.
 *
 * Projects offers exactly four values — high, medium, low, none — and **65 of the first
 * 100 tasks in this portal carry `none`**. That is not "normal priority chosen by
 * somebody"; it is nobody having set one. Both land on `normal` because the schema has no
 * fourth state, but they are not the same fact, so the original is kept in `metadata`
 * rather than being thrown away.
 *
 * `urgent` is unreachable from Projects. It exists for the CRM, whose picklist has
 * Highest; mapping `high` to it here would make a Projects task outrank a CRM task that
 * genuinely is more urgent.
 */
export function taskPriority(priority: unknown): 'low' | 'normal' | 'high' {
  switch ((str(priority) ?? '').toLowerCase()) {
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    default:
      return 'normal';
  }
}

/** The first owner's address. Projects allows several owners on one task and this schema
 *  holds one; the rest are kept in metadata rather than dropped silently. */
export function owners(task: Json): { assignee: string | null; all: string[] } {
  const block = (task.owners_and_work ?? {}) as Json;
  const list = Array.isArray(block.owners) ? (block.owners as Json[]) : [];
  const emails = list.map((o) => str(o.email)).filter((e): e is string => !!e);
  return { assignee: emails[0] ?? null, all: emails };
}

type Cursor = { portalId: string; page: number };

export function readCursor(raw: unknown): Cursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Json;
  const portalId = str(c.portalId);
  if (!portalId) return null;

  const page = Number(c.page);
  return { portalId, page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1 };
}

export const zohoProjects: IntegrationProvider = {
  id: 'zoho_projects',
  name: 'Zoho Projects',
  category: 'work',
  authKind: 'oauth2',
  summary: 'The delivery and marketing task queue, from where the work is actually tracked.',
  provides: ['Tasks', 'Owners', 'Due dates', 'Completion'],
  requiredEnv: [
    {
      name: 'ZOHO_PROJECTS_CLIENT_ID',
      description:
        'A Zoho OAuth client of its own — NOT the CRM’s. Zoho fixes scope at authorisation, so reusing the CRM client would force a CRM reconnect and revoke production’s refresh token.',
    },
    { name: 'ZOHO_PROJECTS_CLIENT_SECRET', description: 'The same client’s secret.' },
  ],
  docsUrl: 'https://www.zoho.com/projects/help/rest-api/introduction.html',

  configFields: [
    {
      name: 'portalId',
      label: 'Portal ID',
      placeholder: '60037687374',
      help: 'Digits only. Left blank, the first portal the connection can see is used, which is right when the account has one.',
      required: false,
      normalise(value) {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (!/^\d+$/.test(trimmed)) throw new Error('A portal ID is digits only — not the portal name or its URL.');
        return trimmed;
      },
    },
  ],

  isConfigured() {
    return !!process.env.ZOHO_PROJECTS_CLIENT_ID && !!process.env.ZOHO_PROJECTS_CLIENT_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      scope: SCOPE,
      client_id: process.env.ZOHO_PROJECTS_CLIENT_ID ?? '',
      response_type: 'code',
      access_type: 'offline',
      // Zoho issues a refresh token only on a client's FIRST authorisation unless consent
      // is re-prompted. Without this, disconnecting and reconnecting fails with "returned
      // no refresh token" and the integration cannot be recovered from the UI at all —
      // the exact trap the CRM provider already hit once.
      prompt: 'consent',
      redirect_uri: redirectUri,
      state,
    });
    return `${ACCOUNTS}/oauth/v2/auth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Zoho Projects uses OAuth.');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_PROJECTS_CLIENT_ID ?? '',
      client_secret: process.env.ZOHO_PROJECTS_CLIENT_SECRET ?? '',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST', signal: httpTimeout() });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { refresh_token?: string; error?: string };
    if (json.error) throw new IntegrationError(`Zoho Projects: ${json.error}`);
    if (!json.refresh_token) {
      throw new IntegrationError('Zoho Projects returned no refresh token. Re-authorise with access_type=offline.');
    }

    // The portal is resolved once, here, rather than on every sync: it never changes for a
    // connection, and a sync that had to discover it would spend a request on it nightly.
    //
    // An OAuth ConnectInput carries no config — only the apiKey variant does — so a portal
    // typed into the form is applied by the caller afterwards and read by syncPaged, which
    // prefers it over this. This is the default for the common case of one portal.
    const token = await accessToken(json.refresh_token);
    const portalId = await firstPortal(token);

    return {
      secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored),
      config: { portalId },
    };
  },

  async syncPaged(credential, config, ctx) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    let cursor = readCursor(ctx.cursor);
    if (!cursor) {
      const portalId = (str(config.portalId) as string) || (await firstPortal(token));
      cursor = { portalId, page: 1 };
    }

    const points: MetricPoint[] = [];

    /**
     * The watermark, and the reason this provider is not a nightly full pull.
     *
     * This portal holds 16,600 tasks — 85 pages — and the first pass took four minutes.
     * Re-fetching all of it every night would spend the whole shared 230s sync budget on
     * one provider and starve everything queued behind it, which is the failure PageSpeed
     * had to be given its own cron to avoid.
     *
     * It is avoided differently here, and more cheaply: results are sorted newest-modified
     * first, so once a whole page predates the watermark there is nothing older worth
     * reading and the pass is complete. That needs no filter syntax, cannot be silently
     * rejected by the API the way a malformed `filter` parameter would be, and degrades to
     * a full pull exactly when it should — on the first sync, when `since` is null.
     */
    const since = ctx.since ? ctx.since.getTime() : null;

    while (cursor.page <= MAX_PAGES) {
      const payload = await get(`/portal/${cursor.portalId}/tasks`, token, {
        page: String(cursor.page),
        per_page: String(PER_PAGE),
        // Newest-modified first. Verified against the live portal rather than assumed —
        // the endpoint's default order is neither, and the early stop below depends on it.
        sort_by: 'DESC(last_modified_time)',
      });

      const tasks = unwrap(payload, 'tasks');

      for (const t of tasks) {
        const id = str(t.id);
        const name = str(t.name);
        if (!id || !name) continue;

        const project = (t.project ?? {}) as Json;
        const tasklist = (t.tasklist ?? {}) as Json;
        const createdBy = (t.created_by ?? {}) as Json;
        const people = owners(t);
        const status = taskStatus(t.status);
        const completedOn = date(t.completed_on);

        points.push({
          entityType: 'work_task',
          entityId: id,
          metricKey: 'record',
          // The day the task was created, so the point's unique key is stable and a
          // re-sync updates the row rather than adding another.
          date: startOfDay(t.created_time),
          value: 1,
          entityLabel: name,
          entityMeta: {
            status,
            priority: taskPriority(t.priority),
            // Zoho's own words, kept because the mapping above is lossy in two places:
            // `none` and `medium` both become `normal`, and any custom status a project
            // adds collapses into open. Without this the original is unrecoverable.
            rawStatus: str((t.status as Json | undefined)?.name),
            rawPriority: str(t.priority),
            assigneeEmail: people.assignee,
            otherOwners: people.all.slice(1),
            createdByEmail: str(createdBy.email),
            // Always null, and deliberately kept rather than dropped. The portal-wide
            // task list does not return `end_date` at all — the MCP connector this
            // mapping was designed against synthesises one, the API does not. Recorded as
            // absent so nobody reads a blank Due column as "nothing is due".
            dueDate: null,
            // Only for a task Zoho actually considers finished. Projects leaves
            // completed_on set on a task that was reopened, so trusting it alone would
            // show a reopened task as done with a date on it.
            completedAt: status === 'done' && completedOn ? completedOn.toISOString() : null,
            projectId: str(project.id),
            projectName: str(project.name),
            tasklistName: str(tasklist.name),
            percentComplete: Number(t.completion_percentage) || 0,
          },
        });
      }

      // Every task on this page already seen. Nothing older can have changed, so the pass
      // is finished rather than merely out of time — a cursor here would make tomorrow
      // start again from page 86 of a list that has since reordered.
      if (since !== null && tasks.length > 0) {
        const newest = Math.max(
          ...tasks.map((t) => date(t.last_modified_time)?.getTime() ?? 0),
        );
        if (newest < since) return { points, cursor: null };
      }

      const more = pageInfo(payload).has_next_page === true && tasks.length > 0;
      if (!more) return { points, cursor: null };

      cursor = { ...cursor, page: cursor.page + 1 };
      if (Date.now() > ctx.deadline) return { points, cursor: cursor as unknown as SyncCursor };
    }

    // Ran to the backstop. Treated as complete rather than looping for ever.
    return { points, cursor: null };
  },
};

/**
 * The first portal this connection can see.
 *
 * Zoho identifies a portal by a numeric id that nothing in the UI shows prominently, so
 * asking somebody to paste one is a step most connections do not need — this account has
 * exactly one portal. The config field stays for an account that has more than one.
 */
async function firstPortal(token: string): Promise<string> {
  const payload = await get('/portals', token);
  const list = unwrap(payload, 'result');
  const id = str(list[0]?.id);
  if (!id) throw new IntegrationError('Zoho Projects returned no portal for this account.');
  return id;
}

/** Midnight UTC for the day a record belongs to, which is what keeps a metric point's
 *  unique key stable across syncs. */
function startOfDay(value: unknown): Date {
  const d = date(value) ?? new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
