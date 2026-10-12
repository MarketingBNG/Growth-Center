import {
  IntegrationError,
  httpTimeout,
  type IntegrationProvider,
  type Json,
  type MetricPoint,
  type SyncContext,
  type SyncCursor,
} from '../types.ts';
import { rateLimited, requestFailed, tokenRejected } from '../messages.ts';
import { num, str } from '../coerce.ts';

// LinkedIn Ads — the third paid channel.
//
// The vocabulary matters here and has already caused one live disagreement: this
// repository's channel slug is `linkedin_ads` in `resolveCampaign` and `linkedin` in the
// integration badge metadata, and the two disagree while an unknown id degrades silently
// rather than failing. The provider id below is `linkedin_ads`, matching `resolveCampaign`
// — the side that actually routes data — and the seeder's orphaned `linkedin_ads` row now
// has a provider behind it instead of rendering as a pending connection that does nothing.
//
// A first successful connection backfills the maximum historical reporting window in
// bounded monthly and daily slices. Later syncs fetch only changes since the last pass.

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com/rest';

/**
 * LinkedIn versions its API by month and requires the header on every call.
 *
 * Pinned deliberately. LinkedIn retires a version roughly a year after release and an
 * unpinned call is not possible — the header is mandatory — so the only choice is which
 * known version to fail loudly on.
 */
const VERSION = '202609';

const SCOPE = 'r_ads r_ads_reporting';

type Stored = {
  accessToken?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
};

type ReportCursor = {
  phase: 'monthly' | 'daily';
  nextDate: string;
  endDate: string;
  dailyStart: string;
  monthlyEnd: string;
  account: string;
  names: Record<string, string>;
};

const HISTORY_YEARS = 10;
const DAILY_WINDOW_MONTHS = 5;
const MAX_ANALYTICS_ELEMENTS = 15_000;

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

function tokenExpiry(seconds: number | undefined): Date | undefined {
  return seconds ? new Date(Date.now() + seconds * 1000) : undefined;
}

function storedCredential(json: LinkedInTokenResponse, previous?: Stored): Stored {
  if (!json.access_token) throw new IntegrationError('LinkedIn returned no access token.');
  const refreshToken = json.refresh_token ?? previous?.refreshToken;
  const refreshTokenExpiresAt = tokenExpiry(json.refresh_token_expires_in)?.toISOString()
    ?? previous?.refreshTokenExpiresAt;
  return {
    accessToken: json.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
  };
}

async function exchangeRefreshToken(refreshToken: string, previous?: Stored): Promise<{
  secret: string;
  expiresAt?: Date;
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
      client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
    }),
    signal: httpTimeout(),
  });
  if (!res.ok) throw new IntegrationError(`LinkedIn token refresh failed (${res.status}).`);

  const json = (await res.json()) as LinkedInTokenResponse;
  return {
    secret: JSON.stringify(storedCredential(json, previous ?? { refreshToken })),
    expiresAt: tokenExpiry(json.expires_in),
  };
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'LinkedIn-Version': VERSION,
    // Without this LinkedIn answers in its older, deeply nested Rest.li 1.0 envelope and
    // every field path below is wrong.
    'X-Restli-Protocol-Version': '2.0.0',
    accept: 'application/json',
  };
}

/**
 * `urn:li:sponsoredCampaign:123456` → `123456`.
 *
 * LinkedIn identifies everything by URN and returns them in full. Storing the URN as the
 * campaign's external id would work until something needs the bare number and gets a
 * string with colons in it.
 */
export function urnId(urn: unknown): string | null {
  const raw = str(urn);
  if (!raw) return null;
  const tail = raw.split(':').pop();
  return tail && /^\d+$/.test(tail) ? tail : null;
}

/**
 * LinkedIn reports a date as `{year, month, day}` inside a range, not as a string.
 *
 * Returns null rather than a guess when any part is missing: a partial date silently
 * becoming today would attribute last month's spend to this morning.
 */
export function readDate(value: unknown): Date | null {
  const d = (value ?? {}) as Json;
  const year = Number(d.year);
  const month = Number(d.month);
  const day = Number(d.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** LinkedIn returns cost as `{amount: "12.34", currencyCode: "USD"}`, the amount a string. */
export function readMoney(value: unknown): { amount: number; currency: string | null } {
  const m = (value ?? {}) as Json;
  return { amount: num(m.amount), currency: str(m.currencyCode) };
}

function errorCode(body: string): string | number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const objects: Record<string, unknown>[] = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const root = parsed as Record<string, unknown>;
    objects.push(root);
    if (Array.isArray(root.errors)) {
      for (const error of root.errors) {
        if (error && typeof error === 'object' && !Array.isArray(error)) {
          objects.push(error as Record<string, unknown>);
        }
      }
    }
  }

  for (const entry of objects) {
    for (const key of ['serviceErrorCode', 'code', 'errorCode']) {
      const value = entry[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)) return value;
    }
  }
  return null;
}

export function describeError(status: number, body: string): string {
  const code = errorCode(body);
  const diagnostic = code === null ? '' : ` LinkedIn error code: ${code}.`;
  if (/REVOKED_ACCESS_TOKEN|EXPIRED/i.test(body) || status === 401) {
    return `${tokenRejected('LinkedIn')} HTTP ${status}.${diagnostic}`;
  }
  if (status === 403) {
    return `LinkedIn refused the request. This usually means the Marketing Developer Platform application has not been approved for this app yet — it gates every advertising endpoint. HTTP ${status}.${diagnostic}`;
  }
  if (status === 429) return `${rateLimited('LinkedIn')} HTTP ${status}.${diagnostic}`;
  return `${requestFailed('LinkedIn', status)}${diagnostic}`;
}

async function get(url: string, token: string): Promise<Json> {
  const res = await fetch(url, { headers: headers(token), signal: httpTimeout() });
  if (!res.ok) throw new IntegrationError(describeError(res.status, await res.text().catch(() => '')));
  return (await res.json()) as Json;
}

/** `(year:2026,month:9,day:1)` — LinkedIn's own literal syntax for a date in a query
 *  string, which is not URL-encoded JSON and not ISO. */
function dateParam(d: Date): string {
  return `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function lastOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function firstOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function earlierDate(a: Date, b: Date): Date {
  return a <= b ? a : b;
}

function laterDate(a: Date, b: Date): Date {
  return a >= b ? a : b;
}

function dateCursor(value: SyncCursor | null): ReportCursor | null {
  if (!value) return null;
  const cursor = value as Partial<ReportCursor>;
  if (
    (cursor.phase !== 'monthly' && cursor.phase !== 'daily') ||
    typeof cursor.nextDate !== 'string' ||
    typeof cursor.endDate !== 'string' ||
    typeof cursor.dailyStart !== 'string' ||
    typeof cursor.monthlyEnd !== 'string' ||
    typeof cursor.account !== 'string' ||
    !cursor.names ||
    typeof cursor.names !== 'object'
  ) {
    throw new IntegrationError('LinkedIn historical sync cursor is invalid. Restart the sync.');
  }
  return cursor as ReportCursor;
}

async function analyticsElements(
  token: string,
  account: string,
  from: Date,
  to: Date,
  granularity: 'DAILY' | 'MONTHLY',
): Promise<Json[]> {
  const params = [
    'q=analytics',
    'pivot=CAMPAIGN',
    `timeGranularity=${granularity}`,
    `dateRange=(start:${dateParam(from)},end:${dateParam(to)})`,
    `accounts=List(urn%3Ali%3AsponsoredAccount%3A${account})`,
    'fields=costInLocalCurrency,impressions,clicks,dateRange,pivotValues',
  ].join('&');

  const payload = await get(`${API}/adAnalytics?${params}`, token);
  const elements = Array.isArray(payload.elements) ? (payload.elements as Json[]) : [];
  if (elements.length >= MAX_ANALYTICS_ELEMENTS) {
    throw new IntegrationError(
      `LinkedIn returned ${MAX_ANALYTICS_ELEMENTS.toLocaleString()} campaign report rows for one date slice, reaching its response limit. The account needs smaller report slices.`,
    );
  }
  return elements;
}

function metricPoints(
  elements: Json[],
  names: Map<string, string>,
  monthlyDate?: Date,
): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const row of elements) {
    const pivots = Array.isArray(row.pivotValues) ? row.pivotValues : [];
    const id = urnId(pivots[0]);
    if (!id) continue;

    const range = (row.dateRange ?? {}) as Json;
    const date = monthlyDate ?? readDate(range.start);
    if (!date) continue;

    const cost = readMoney(row.costInLocalCurrency);
    const meta = { currency: cost.currency ?? undefined };

    for (const [metricKey, value] of [
      ['spend', cost.amount],
      ['impressions', num(row.impressions)],
      ['clicks', num(row.clicks)],
    ] as const) {
      points.push({
        entityType: 'ad_campaign',
        entityId: id,
        entityLabel: names.get(id) ?? `Campaign ${id}`,
        metricKey,
        date,
        value,
        entityMeta: meta,
      });
    }
  }
  return points;
}

async function initialCursor(
  token: string,
  accountSetting: unknown,
  ctx: SyncContext,
): Promise<ReportCursor> {
  const end = ctx.range.to;
  const endDate = dateString(end);
  const historyStart = new Date(end);
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - HISTORY_YEARS);

  // Daily reporting is limited to the recent period. Keeping a full five calendar
  // months daily stays inside LinkedIn's six-month daily-retention window with margin.
  const dailyStart = new Date(end);
  dailyStart.setUTCDate(1);
  dailyStart.setUTCMonth(dailyStart.getUTCMonth() - DAILY_WINDOW_MONTHS);
  const dailyStartString = dateString(dailyStart);
  const monthlyEnd = dateString(shiftDays(dailyStart, -1));

  const account =
    str(accountSetting) ? urnId(accountSetting) ?? str(accountSetting)! : await firstAccount(token);
  const names = await campaignNames(token, account);

  const requestedSince = ctx.since ? shiftDays(ctx.since, -1) : null;
  const firstDate = requestedSince
    ? laterDate(historyStart, requestedSince)
    : historyStart;
  const phase = dateString(firstDate) <= monthlyEnd ? 'monthly' : 'daily';

  return {
    phase,
    nextDate: dateString(firstDate),
    endDate,
    dailyStart: dailyStartString,
    monthlyEnd,
    account,
    names: Object.fromEntries(names),
  };
}

function nextWindow(cursor: ReportCursor): {
  from: Date;
  to: Date;
  granularity: 'DAILY' | 'MONTHLY';
  next: ReportCursor | null;
} {
  let phase = cursor.phase;
  let nextDate = cursor.nextDate;

  if (phase === 'monthly' && nextDate > cursor.monthlyEnd) {
    phase = 'daily';
    nextDate = cursor.dailyStart;
  }

  const end = fromDateString(cursor.endDate);
  const start = fromDateString(nextDate);
  if (phase === 'monthly') {
    const to = earlierDate(lastOfMonth(start), fromDateString(cursor.monthlyEnd));
    const next = firstOfNextMonth(start);
    const followingPhase = dateString(next) > cursor.monthlyEnd ? 'daily' : 'monthly';
    return {
      from: start,
      to,
      granularity: 'MONTHLY',
      next: {
        ...cursor,
        phase: followingPhase,
        nextDate: followingPhase === 'daily' ? cursor.dailyStart : dateString(next),
      },
    };
  }

  const to = earlierDate(shiftDays(start, 6), end);
  const nextDateAfterWindow = dateString(shiftDays(to, 1));
  return {
    from: start,
    to,
    granularity: 'DAILY',
    next:
      nextDateAfterWindow > cursor.endDate
        ? null
        : { ...cursor, phase: 'daily', nextDate: nextDateAfterWindow },
  };
}

export const linkedinAds: IntegrationProvider = {
  // Matches `resolveCampaign`, which is the side that routes data. The badge metadata's
  // `linkedin` is the one that was wrong.
  id: 'linkedin_ads',
  name: 'LinkedIn Ads',
  category: 'ads',
  authKind: 'oauth2',
  summary: 'Sponsored content spend, impressions and clicks, daily recently and monthly historically.',
  provides: ['Spend', 'Impressions', 'Clicks', 'CPC', 'CPM'],
  requiredEnv: [
    {
      name: 'LINKEDIN_CLIENT_ID',
      description:
        'From a LinkedIn app with the Marketing Developer Platform product approved — the approval gates every endpoint here and is reviewed by LinkedIn.',
    },
    { name: 'LINKEDIN_CLIENT_SECRET', description: 'That app’s secret.' },
  ],
  docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/',
  backfillHistoryWhenEmpty: true,

  channel: { slug: 'linkedin-ads', name: 'LinkedIn Ads', kind: 'paid' },

  configFields: [
    {
      name: 'adAccountId',
      label: 'Ad account ID',
      placeholder: '512345678',
      help: 'Campaign Manager → the number in the URL. Digits only; a full URN is accepted and reduced.',
      required: false,
      normalise(value) {
        const trimmed = value.trim();
        if (!trimmed) return '';
        const id = /^\d+$/.test(trimmed) ? trimmed : urnId(trimmed);
        if (!id) throw new Error('An ad account is digits, or the urn:li:sponsoredAccount:… form.');
        return id;
      },
    },
  ],

  isConfigured() {
    return !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: SCOPE,
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('LinkedIn Ads uses OAuth.');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
      }),
      signal: httpTimeout(),
    });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as LinkedInTokenResponse;
    const stored = storedCredential(json);
    const expiresAt = tokenExpiry(json.expires_in);

    return {
      secret: JSON.stringify(stored),
      expiresAt,
    };
  },

  async refresh(credential) {
    const stored = JSON.parse(credential) as Stored;
    if (!stored.refreshToken) return null;
    return exchangeRefreshToken(stored.refreshToken, stored);
  },

  async syncPaged(credential, config, ctx) {
    const stored = JSON.parse(credential) as Stored;
    // Older credentials stored the access token under `refreshToken` when LinkedIn did
    // not issue a separate refresh token.
    const token = stored.accessToken ?? stored.refreshToken;
    if (!token) throw new IntegrationError('LinkedIn access token is missing. Reconnect the integration.');

    const cursor = dateCursor(ctx.cursor);
    const state = cursor ?? (await initialCursor(token, config.adAccountId, ctx));
    const window = nextWindow(state);
    const elements = await analyticsElements(
      token,
      state.account,
      window.from,
      window.to,
      window.granularity,
    );

    return {
      // The storage model keys spend by calendar date, so place each monthly aggregate
      // on that month’s final day. This keeps it in range when a report starts mid-month.
      points: metricPoints(
        elements,
        new Map(Object.entries(state.names)),
        window.granularity === 'MONTHLY' ? window.to : undefined,
      ),
      cursor: window.next as SyncCursor | null,
    };
  },
};

/** Campaign id to name, so a campaign is not rendered as a bare number. */
async function campaignNames(token: string, account: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const payload = await get(
      `${API}/adAccounts/${account}/adCampaigns?q=search&fields=id,name&count=500`,
      token,
    );
    const elements = Array.isArray(payload.elements) ? (payload.elements as Json[]) : [];
    for (const c of elements) {
      const id = str(c.id) ?? urnId(c.id);
      const name = str(c.name);
      if (id && name) out.set(id, name);
    }
  } catch {
    // A label is worth having and not worth failing a sync of real spend over.
  }
  return out;
}

/** The first ad account this login can see, when none was configured. */
async function firstAccount(token: string): Promise<string> {
  const payload = await get(`${API}/adAccounts?q=search&fields=id,name&count=10`, token);
  const elements = Array.isArray(payload.elements) ? (payload.elements as Json[]) : [];
  const id = str(elements[0]?.id) ?? urnId(elements[0]?.id);
  if (!id) throw new IntegrationError('LinkedIn returned no ad accounts for this login.');
  return id;
}
