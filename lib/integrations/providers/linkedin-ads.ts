import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';

// LinkedIn Ads — the third paid channel.
//
// The vocabulary matters here and has already caused one live disagreement: this
// repository's channel slug is `linkedin_ads` in `resolveCampaign` and `linkedin` in the
// integration badge metadata, and the two disagree while an unknown id degrades silently
// rather than failing. The provider id below is `linkedin_ads`, matching `resolveCampaign`
// — the side that actually routes data — and the seeder's orphaned `linkedin_ads` row now
// has a provider behind it instead of rendering as a pending connection that does nothing.
//
// **Blocked on LinkedIn, not on this code.** The Marketing Developer Platform application
// gates every endpoint used here; until it is approved the calls return 403. The provider
// is written anyway because the approval and the build are independent, and the approval
// is the slow half.

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com/rest';

/**
 * LinkedIn versions its API by month and requires the header on every call.
 *
 * Pinned deliberately. LinkedIn retires a version roughly a year after release and an
 * unpinned call is not possible — the header is mandatory — so the only choice is which
 * known version to fail loudly on.
 */
const VERSION = '202411';

const SCOPE = 'r_ads r_ads_reporting';

type Stored = { refreshToken: string; expiresAt?: string };
type Json = Record<string, unknown>;

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

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

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

function describeError(status: number, body: string): string {
  if (/REVOKED_ACCESS_TOKEN|EXPIRED/i.test(body) || status === 401) {
    return 'LinkedIn rejected the token. Reconnect the integration.';
  }
  if (status === 403) {
    return 'LinkedIn refused the request. This usually means the Marketing Developer Platform application has not been approved for this app yet — it gates every advertising endpoint.';
  }
  if (status === 429) return 'LinkedIn is rate-limiting requests. It will resume on the next run.';
  return `LinkedIn request failed (${status}).`;
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

export const linkedinAds: IntegrationProvider = {
  // Matches `resolveCampaign`, which is the side that routes data. The badge metadata's
  // `linkedin` is the one that was wrong.
  id: 'linkedin_ads',
  name: 'LinkedIn Ads',
  category: 'ads',
  authKind: 'oauth2',
  summary: 'Sponsored content spend, impressions and clicks, per campaign per day.',
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

    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) throw new IntegrationError('LinkedIn returned no access token.');

    // LinkedIn issues a refresh token only to apps approved for it; others get a
    // 60-day access token and nothing else. Both are stored the same way and `refresh`
    // below handles the difference, rather than failing a connection that would work
    // for two months.
    const expiresAt = json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : undefined;

    return {
      secret: JSON.stringify({ refreshToken: json.refresh_token ?? json.access_token, expiresAt } satisfies Stored),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    };
  },

  async sync(credential, config, range) {
    const { refreshToken: token } = JSON.parse(credential) as Stored;

    const account = str(config.adAccountId) ?? (await firstAccount(token));

    // Analytics pivoted by campaign, one row per campaign per day. `timeGranularity:DAILY`
    // is what makes it per-day; without it LinkedIn returns one aggregated row for the
    // whole range and every day would carry the same total.
    const params = [
      'q=analytics',
      'pivot=CAMPAIGN',
      'timeGranularity=DAILY',
      `dateRange=(start:${dateParam(range.from)},end:${dateParam(range.to)})`,
      `accounts=List(urn%3Ali%3AsponsoredAccount%3A${account})`,
      'fields=costInLocalCurrency,impressions,clicks,dateRange,pivotValues',
    ].join('&');

    const payload = await get(`${API}/adAnalytics?${params}`, token);
    const elements = Array.isArray(payload.elements) ? (payload.elements as Json[]) : [];

    // Campaign names come from a second call: analytics returns the URN and no label, and
    // a campaign showing as its own id is not something anybody can act on.
    const names = await campaignNames(token, account);

    const points: MetricPoint[] = [];

    for (const row of elements) {
      const pivots = Array.isArray(row.pivotValues) ? row.pivotValues : [];
      const id = urnId(pivots[0]);
      if (!id) continue;

      const range_ = (row.dateRange ?? {}) as Json;
      const date = readDate(range_.start);
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
