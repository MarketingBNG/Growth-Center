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
  // Converted__s and Converted_Date_Time are what make a converted lead visible at all.
  // Zoho keeps a converted lead in this module with the flag set; without asking for it,
  // convertedAt stayed null on all 26,151 leads and the app could not answer "which leads
  // converted in August" even though the CRM knew.
  Leads:
    'id,First_Name,Last_Name,Email,Phone,Company,Designation,Lead_Status,Lead_Source,Description,Owner,Created_Time,Converted__s,Converted_Date_Time',
  Contacts: 'id,First_Name,Last_Name,Email,Phone,Title,Account_Name,Owner,Created_Time',
  Deals:
    'id,Deal_Name,Amount,Stage,Closing_Date,Probability,Currency,Account_Name,Contact_Name,Owner,Created_Time',
  // What_Id is the record the activity is about (a lead or a deal); Who_Id is the person
  // on it. Both are needed or an imported call hangs off nothing and never reaches a page.
  // Companies used to be invented from the account name a contact or deal happened to
  // mention, so every one of the 2,761 had a name and nothing else. Read properly, the
  // module carries the details that make a company record worth having.
  Accounts:
    'id,Account_Name,Website,Phone,Industry,Employees,Billing_Country,Description,Owner,Created_Time',
  Tasks: 'id,Subject,Status,Priority,Due_Date,Description,Owner,What_Id,Who_Id,Created_Time',
  Calls: 'id,Subject,Call_Type,Call_Start_Time,Call_Duration,Description,Owner,What_Id,Who_Id,Created_Time',
  Events: 'id,Event_Title,Start_DateTime,End_DateTime,Description,Owner,What_Id,Who_Id,Created_Time',
};

type Module = 'Accounts' | 'Leads' | 'Contacts' | 'Deals' | 'Tasks' | 'Calls' | 'Events';
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

  // Zoho's Leads endpoint returns UNCONVERTED leads unless told otherwise, so every lead
  // that turned into a customer was silently absent — the successful outcomes, missing
  // from the funnel, with no error to say so. `both` asks for the whole module.
  if (moduleName === 'Leads') params.set('converted', 'both');

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

/**
 * Undoes mojibake — UTF-8 bytes that were decoded as Latin-1 somewhere upstream, so
 * "श्री" arrives as "Ã Â¤Â¶Ã Â¥Â€".
 *
 * The damage is in the CRM's own data, not in this transport, so it cannot be fixed by
 * asking Zoho differently: those records were imported into Zoho already broken. Names
 * are the one field a person reads to recognise their own customer, so they are repaired
 * on the way in rather than left to render as noise on the Pipeline board.
 *
 * A minority of records — 35 of 26,073 leads — are beyond repair: their mangling also
 * stripped the bytes that fell in the C1 control range, so the sequence is missing
 * information rather than merely misread. Reconstructing those would mean guessing which
 * character was lost, which invents names. The U+FFFD guard below refuses them, and they
 * keep their mangled text until someone fixes the record in Zoho itself.
 *
 * Applied twice because the pattern seen here is doubly encoded, and guarded three ways:
 * only strings that look mojibake'd are touched, only strings that fit in a byte can be
 * reinterpreted as bytes at all, and a pass that produces U+FFFD is discarded. A string
 * that is merely accented — "Renée", "Muñoz" — matches none of that and is returned as
 * it came.
 */
export function repairEncoding(value: string): string {
  let out = value;

  for (let pass = 0; pass < 2; pass++) {
    // The signature of the damage: a byte that leads a UTF-8 sequence (C2-F4) followed by
    // one that continues it (80-BF), both stranded as Latin-1 characters. Accented prose
    // does not produce this — in "Muñoz" the ñ is followed by a plain letter, not by a
    // continuation byte.
    if (!/[Â-ô][-¿]/.test(out)) break;
    // Reinterpreting as bytes only makes sense while every code point still is one.
    if (/[^ -ÿ]/.test(out)) break;

    const decoded = Buffer.from(out, 'latin1').toString('utf8');
    if (decoded.includes('�')) break;
    out = decoded;
  }

  return out;
}

const text = (value: unknown): string | null => {
  const s = value == null ? '' : repairEncoding(String(value)).trim();
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
const MODULES: Module[] = ['Accounts', 'Leads', 'Contacts', 'Deals', 'Tasks', 'Calls', 'Events'];

export type Cursor = { module: Module; page: number; pageToken: string | null };

/** Reads back a cursor the service stored. Anything unrecognised — a cursor written by an
 *  older version, a module since removed — restarts the pull rather than throwing, which
 *  costs one full pass and cannot wedge the integration. */
export function readCursor(raw: unknown): Cursor {
  // MODULES[0], never a named module: the pull walks the list forwards, so hardcoding a
  // starting point silently skips everything added before it.
  const fresh: Cursor = { module: MODULES[0], page: 1, pageToken: null };
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
        converted: row.Converted__s === true,
        convertedAt: text(row.Converted_Date_Time),
      },
    };
  }

  if (moduleName === 'Accounts') {
    return {
      entityType: 'crm_account',
      entityId: id,
      metricKey: 'record',
      date,
      value: 1,
      entityLabel: text(row.Account_Name) ?? id,
      entityMeta: {
        name: text(row.Account_Name),
        website: text(row.Website),
        phone: text(row.Phone),
        industry: text(row.Industry),
        country: text(row.Billing_Country),
        // Zoho stores a headcount; the column here is a band, so the number is kept as
        // written rather than bucketed into ranges nobody chose.
        size: row.Employees == null ? null : String(row.Employees),
        notes: text(row.Description),
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

  // Tasks, Calls and Events all describe work done against a record rather than the
  // record itself, so they carry the same shape: what it was about, who did it, when.
  // What_Id is the lead or deal; Who_Id the contact. Which of the two a given id refers
  // to is Zoho's business, so both are passed through and resolved on the write side
  // against the records already imported.
  if (moduleName === 'Tasks') {
    const what = lookup(row.What_Id);
    const who = lookup(row.Who_Id);
    return {
      entityType: 'crm_task',
      entityId: id,
      metricKey: 'record',
      date,
      value: 1,
      entityLabel: text(row.Subject) ?? id,
      entityMeta: {
        title: text(row.Subject),
        detail: text(row.Description),
        status: text(row.Status),
        priority: text(row.Priority),
        dueDate: text(row.Due_Date),
        whatId: what?.id ?? null,
        whoId: who?.id ?? null,
        ownerEmail: owner?.name ?? null,
      },
    };
  }

  if (moduleName === 'Calls' || moduleName === 'Events') {
    const what = lookup(row.What_Id);
    const who = lookup(row.Who_Id);
    const isCall = moduleName === 'Calls';
    // Dated by when it happened, not when the record was typed up — an event booked in
    // advance and a call logged afterwards both belong on the day of the conversation.
    const happenedAt = text(isCall ? row.Call_Start_Time : row.Start_DateTime);
    const happened = happenedAt ? new Date(happenedAt) : null;

    return {
      entityType: 'crm_activity',
      entityId: id,
      metricKey: 'record',
      date: happened && !Number.isNaN(happened.getTime()) ? happened : date,
      value: 1,
      entityLabel: text(isCall ? row.Subject : row.Event_Title) ?? id,
      entityMeta: {
        kind: isCall ? 'call' : 'meeting',
        summary: text(isCall ? row.Subject : row.Event_Title),
        detail: text(row.Description),
        direction: isCall ? text(row.Call_Type) : null,
        duration: isCall ? text(row.Call_Duration) : null,
        endsAt: isCall ? null : text(row.End_DateTime),
        whatId: what?.id ?? null,
        whoId: who?.id ?? null,
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
