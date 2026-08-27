import { IntegrationError, type Entity, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Zoho CRM. BNG already runs Zoho, and bng-command-center's lib/zoho.ts is the working
// reference for this token lifecycle — a long-lived refresh token minting short-lived
// access tokens per request.

/**
 * Zoho is region-partitioned: an account created in India lives on accounts.zoho.IN and
 * is invisible to accounts.zoho.COM. This was hardcoded to .com, which could never have
 * authenticated — bng-command-center, which does work, points at accounts.zoho.in.
 *
 * Defaulted to India for that reason, overridable for anyone on another region.
 */
const DC = (process.env.ZOHO_DC ?? 'in').replace(/[^a-z.]/gi, '').toLowerCase() || 'in';

const ACCOUNTS = `https://accounts.zoho.${DC}`;
const API = `https://www.zohoapis.${DC}/crm/v6`;
const SCOPE = 'ZohoCRM.modules.READ,ZohoCRM.settings.READ';

/** Zoho caps per_page at 200.
 *
 *  MAX_PAGES is not the time budget — the caller's deadline is, and the cursor means a
 *  pull can span as many runs as it needs. This is only a backstop against a module that
 *  never stops claiming more_records. 400 pages is 80,000 records, comfortably above this
 *  org's largest (26,000 leads). */
const PER_PAGE = 200;
const MAX_PAGES = 400;

type Stored = { refreshToken: string };

async function accessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.ZOHO_CLIENT_ID ?? '',
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new IntegrationError(`Zoho token refresh failed (${res.status}).`);

  const json = (await res.json()) as { access_token?: string; error?: string };
  if (json.error) throw new IntegrationError(`Zoho: ${json.error}`);
  if (!json.access_token) throw new IntegrationError('Zoho returned no access token.');
  return json.access_token;
}

/** The fields each module is read with. Zoho v6 returns only what is asked for, so an
 *  omission here is a column that silently arrives empty in Growth Center. */
const FIELDS: Record<Module, string> = {
  Leads:
    'id,First_Name,Last_Name,Email,Phone,Company,Designation,Lead_Status,Lead_Source,Description,Owner,Created_Time',
  Contacts: 'id,First_Name,Last_Name,Email,Phone,Title,Account_Name,Owner,Created_Time',
  Deals:
    'id,Deal_Name,Amount,Stage,Closing_Date,Probability,Currency,Account_Name,Contact_Name,Owner,Created_Time',
};

type Module = 'Leads' | 'Contacts' | 'Deals';
type Row = Record<string, unknown>;

/**
 * One page of one module.
 *
 * Deliberately a single page rather than a whole module: with 26,000 leads here, "fetch
 * everything then write it" is a request that cannot reliably finish, and a partial run
 * would leave nothing behind. The caller writes each page before asking for the next.
 *
 * `since` becomes an If-Modified-Since header, which is what makes a routine sync a
 * handful of changed records instead of the whole CRM again.
 */
async function readPage(
  token: string,
  moduleName: Module,
  cursor: { page: number; pageToken: string | null },
  since: Date | null,
): Promise<{ rows: Row[]; nextPageToken: string | null; more: boolean }> {
  const params = new URLSearchParams({
    fields: FIELDS[moduleName],
    per_page: String(PER_PAGE),
  });

  // `page` alone stops working past 2,000 records — beyond that Zoho requires the token
  // it hands back in info.next_page_token. Paging by number would have silently returned
  // the first 2,000 leads and presented them as the whole CRM.
  if (cursor.pageToken) params.set('page_token', cursor.pageToken);
  else params.set('page', String(cursor.page));

  const headers: Record<string, string> = { authorization: `Zoho-oauthtoken ${token}` };
  if (since) headers['If-Modified-Since'] = since.toISOString();

  const res = await fetch(`${API}/${moduleName}?${params}`, { headers });

  // 204 is "nothing here" — an empty module, or nothing modified since. Both are a
  // successful, complete answer, not a failure.
  if (res.status === 204) return { rows: [], nextPageToken: null, more: false };
  if (!res.ok) throw new IntegrationError(`Zoho ${moduleName} request failed (${res.status}).`);

  const json = (await res.json()) as {
    data?: Row[];
    info?: { more_records?: boolean; next_page_token?: string | null };
  };

  return {
    rows: json.data ?? [],
    nextPageToken: json.info?.next_page_token ?? null,
    more: !!json.info?.more_records,
  };
}

/** Zoho lookup fields arrive as `{ id, name }`; plain values arrive bare. */
function lookup(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { id?: unknown; name?: unknown };
  if (!v.id) return null;
  return { id: String(v.id), name: String(v.name ?? v.id) };
}

const text = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

/** The date a metric point is filed under. Zoho's Created_Time is stable across syncs,
 *  which keeps the point's unique key stable and makes a re-sync an update, not a row. */
function createdDate(row: Row): Date {
  const raw = text(row.Created_Time);
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** The modules pulled, in the order they are pulled. Accounts are not fetched directly —
 *  they arrive as the lookup on a contact or a deal, which is every account that matters
 *  to this app and none of the ones that matter to nobody. */
const MODULES: Module[] = ['Leads', 'Contacts', 'Deals'];

export type Cursor = { module: Module; page: number; pageToken: string | null };

/** Reads back a cursor the service stored. Anything unrecognised — a cursor written by an
 *  older version, a module since removed — restarts the pull rather than throwing, which
 *  costs one full pass and cannot wedge the integration. */
export function readCursor(raw: unknown): Cursor {
  const fresh: Cursor = { module: 'Leads', page: 1, pageToken: null };
  if (!raw || typeof raw !== 'object') return fresh;

  const c = raw as Record<string, unknown>;
  const moduleName = MODULES.find((m) => m === c.module);
  if (!moduleName) return fresh;

  const page = Number(c.page);
  return {
    module: moduleName,
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    pageToken: typeof c.pageToken === 'string' && c.pageToken !== '' ? c.pageToken : null,
  };
}

/** One Zoho record as the point that carries it. Returns null for a record with no id,
 *  which cannot be matched on a re-sync and would insert a duplicate every night. */
function toPoint(moduleName: Module, row: Row): MetricPoint | null {
  const id = text(row.id);
  if (!id) return null;

  const owner = lookup(row.Owner);
  const account = lookup(row.Account_Name);
  const date = createdDate(row);

  if (moduleName === 'Leads') {
    const first = text(row.First_Name);
    const last = text(row.Last_Name);
    return {
      entityType: 'crm_lead',
      entityId: id,
      metricKey: 'record',
      date,
      value: 1,
      entityLabel: [first, last].filter(Boolean).join(' ') || (text(row.Company) ?? id),
      entityMeta: {
        firstName: first,
        lastName: last,
        email: text(row.Email),
        phone: text(row.Phone),
        companyName: text(row.Company),
        title: text(row.Designation),
        message: text(row.Description),
        status: text(row.Lead_Status),
        leadSource: text(row.Lead_Source),
        ownerEmail: owner?.name ?? null,
      },
    };
  }

  if (moduleName === 'Contacts') {
    const first = text(row.First_Name);
    const last = text(row.Last_Name);
    return {
      entityType: 'crm_contact',
      entityId: id,
      metricKey: 'record',
      date,
      value: 1,
      entityLabel: [first, last].filter(Boolean).join(' ') || id,
      entityMeta: {
        firstName: first,
        lastName: last,
        email: text(row.Email),
        phone: text(row.Phone),
        title: text(row.Title),
        accountId: account?.id ?? null,
        accountName: account?.name ?? null,
        ownerEmail: owner?.name ?? null,
      },
    };
  }

  const contact = lookup(row.Contact_Name);
  return {
    entityType: 'crm_deal',
    entityId: id,
    metricKey: 'record',
    date,
    value: Number(row.Amount) || 0,
    entityLabel: text(row.Deal_Name) ?? id,
    entityMeta: {
      amount: Number(row.Amount) || 0,
      currency: text(row.Currency) ?? 'USD',
      stage: text(row.Stage),
      probability: Number(row.Probability) || 0,
      closingDate: text(row.Closing_Date),
      accountId: account?.id ?? null,
      accountName: account?.name ?? null,
      contactId: contact?.id ?? null,
      ownerEmail: owner?.name ?? null,
    },
  };
}

export const zohoCrm: IntegrationProvider = {
  id: 'zoho_crm',
  name: 'Zoho CRM',
  category: 'crm',
  authKind: 'oauth2',
  summary: 'Leads, contacts and deals from the CRM the firm already runs.',
  provides: ['Leads', 'Contacts', 'Deals', 'Accounts', 'Deal stages'],
  requiredEnv: [
    { name: 'ZOHO_CLIENT_ID', description: 'Zoho API console self-client or server app' },
    { name: 'ZOHO_CLIENT_SECRET', description: 'Secret for that Zoho client' },
  ],
  docsUrl: 'https://www.zoho.com/crm/developer/docs/api/v6/',

  isConfigured() {
    return !!process.env.ZOHO_CLIENT_ID && !!process.env.ZOHO_CLIENT_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      scope: SCOPE,
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      response_type: 'code',
      access_type: 'offline',
      // Zoho returns a refresh_token only on a client's FIRST authorisation unless
      // consent is re-prompted. Without this, disconnecting and reconnecting failed
      // with "Zoho returned no refresh token" and the integration could not be
      // recovered from the UI at all.
      prompt: 'consent',
      redirect_uri: redirectUri,
      state,
    });
    return `${ACCOUNTS}/oauth/v2/auth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Zoho CRM uses OAuth.');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { refresh_token?: string; error?: string };
    if (json.error) throw new IntegrationError(`Zoho: ${json.error}`);
    if (!json.refresh_token) {
      throw new IntegrationError('Zoho returned no refresh token. Re-authorise with access_type=offline.');
    }
    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async syncPaged(credential, _config, ctx) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    // Records, not counts. This used to report three `record_count` numbers and nothing
    // else, which nothing in the app read — the CRM pages read Lead/Contact/Opportunity,
    // so a perfect sync left every one of them showing only seeded rows. The points below
    // carry the whole record in entityMeta so writeCrmRecords() in service.ts can
    // materialise it, the same way ad_campaign points become Campaign rows.
    const state = readCursor(ctx.cursor);
    const points: MetricPoint[] = [];

    let { module: moduleName, page, pageToken } = state;

    // Fetch until the caller's deadline, then hand back where we stopped. Always at least
    // one page, so a tight budget still makes progress instead of spinning.
    do {
      const { rows, nextPageToken, more } = await readPage(
        token,
        moduleName,
        { page, pageToken },
        ctx.since,
      );

      for (const row of rows) {
        const point = toPoint(moduleName, row);
        if (point) points.push(point);
      }

      if (more && page < MAX_PAGES) {
        page += 1;
        pageToken = nextPageToken;
      } else {
        // This module is done. Move to the next, or finish the pull.
        const next = MODULES[MODULES.indexOf(moduleName) + 1];
        if (!next) return { points, cursor: null };
        moduleName = next;
        page = 1;
        pageToken = null;
      }
    } while (Date.now() < ctx.deadline);

    return { points, cursor: { module: moduleName, page, pageToken } };
  },

  async getEntities(credential, _config, type) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    const moduleName = type === 'deal' ? 'Deals' : type === 'contact' ? 'Contacts' : 'Leads';
    const res = await fetch(`${API}/${moduleName}?per_page=50`, {
      headers: { authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) throw new IntegrationError(`Zoho ${moduleName} request failed (${res.status}).`);

    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    return (json.data ?? []).map<Entity>((raw) => ({
      id: String(raw.id),
      type,
      label:
        (raw.Deal_Name as string) ??
        (raw.Full_Name as string) ??
        [raw.First_Name, raw.Last_Name].filter(Boolean).join(' ') ??
        String(raw.id),
      raw,
    }));
  },
};
