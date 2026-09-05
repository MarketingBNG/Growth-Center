import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Google Ads — the second paid channel, and the reason CAC and CPL stop being blended.
//
// Both of those figures are computed over every customer and every lead while the spend
// beneath them comes from Meta alone, so today they read as "cost per lead" and mean
// "cost per lead if Meta were the only thing we paid for". The Marketing page labels them
// blended, which is honest and does not make them right.
//
// None of this needs Campaign_ID on the lead. Spend, impressions and clicks are reported
// by the ad platform about itself; the null Campaign_ID blocks joining a *lead* to a
// campaign, which is a different and still-blocked question. Cost per click and cost per
// thousand are available today, exactly as they are for Meta.
//
// Reuses GOOGLE_CLIENT_ID — Google scopes per authorisation, so this cannot disturb GA4,
// Search Console or YouTube.
//
// **The developer token is the part that takes time.** Google issues one per manager
// account and a new one starts with Test Account access only, which returns real-looking
// responses for test accounts and an error for a production customer. Basic access is a
// form Google reviews by hand. That failure is named below rather than reported as a
// generic 403, because it is the single most likely reason this does not work on the
// first try.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Pinned rather than floating.
 *
 * Google Ads retires an API version roughly every four months and a retired version stops
 * answering. A pinned version fails loudly on a known date; `v-latest` would change the
 * response shape underneath a working sync without anything in this repository changing.
 */
const API = 'https://googleads.googleapis.com/v18';

const SCOPE = 'https://www.googleapis.com/auth/adwords';

type Stored = { refreshToken: string };
type Json = Record<string, unknown>;

/**
 * Campaign-day spend, impressions and clicks.
 *
 * GAQL, not REST paths: the Google Ads API has one query endpoint and a SQL-like language
 * over it. `segments.date` is what turns a campaign row into one row per campaign per
 * day, which is the grain MarketingSpend stores and the grain budget pacing needs.
 *
 * Campaigns with no impressions on a day are excluded by Google by default, which is
 * correct here: a row of zeroes for every paused campaign every day would be most of the
 * table and would mean nothing.
 */
const QUERY = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    campaign.start_date,
    campaign.end_date,
    campaign_budget.amount_micros,
    customer.currency_code,
    segments.date,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks
  FROM campaign
  WHERE segments.date BETWEEN '{from}' AND '{to}'
`;

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: httpTimeout(),
  });
  if (!res.ok) {
    throw new IntegrationError(`Google rejected the refresh token (${res.status}). Reconnect the integration.`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new IntegrationError('Google returned no access token.');
  return json.access_token;
}

/** Digits only. Google prints customer ids as 123-456-7890 and the API refuses the dashes. */
export function customerId(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Micros are Google's unit for money: 1,000,000 micros is one unit of the account's
 * currency. Storing the raw figure would report a ₹450 day as ₹450,000,000.
 */
export function fromMicros(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
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
 * What went wrong, in the words most likely to be true.
 *
 * A developer token with only Test Account access is the commonest cause of a failed
 * first sync here and it does not say so plainly — Google returns a
 * DEVELOPER_TOKEN_NOT_APPROVED inside a nested error array that reads as a generic
 * permission problem.
 */
export function describeError(status: number, body: string): string {
  if (/DEVELOPER_TOKEN_NOT_APPROVED/i.test(body)) {
    return 'The Google Ads developer token has Test Account access only. Apply for Basic access — it is reviewed by hand and this will not work until it is granted.';
  }
  if (/CUSTOMER_NOT_ENABLED|CUSTOMER_NOT_FOUND/i.test(body)) {
    return 'Google Ads does not recognise that customer ID for this login. Check the ID, and that the connected account has access to it.';
  }
  if (/USER_PERMISSION_DENIED/i.test(body)) {
    return 'The connected Google account has no access to that Ads customer. Connect the account that does, or set the manager account ID.';
  }
  if (status === 401) return 'Google rejected the token. Reconnect the integration.';
  if (status === 429) return 'Google Ads is rate-limiting requests. It will resume on the next run.';
  return `Google Ads request failed (${status}).`;
}

export const googleAds: IntegrationProvider = {
  id: 'google_ads',
  name: 'Google Ads',
  category: 'ads',
  authKind: 'oauth2',
  summary: 'Search and display spend, impressions and clicks, per campaign per day.',
  provides: ['Spend', 'Impressions', 'Clicks', 'CPC', 'CPM'],
  requiredEnv: [
    { name: 'GOOGLE_CLIENT_ID', description: 'The OAuth client GA4 and Search Console already use, with the Google Ads API enabled.' },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'That client’s secret.' },
    {
      name: 'GOOGLE_ADS_DEVELOPER_TOKEN',
      description:
        'From the manager account under API Center. A new token has Test Account access only — Basic access is a form Google reviews by hand, and nothing here works until it is granted.',
    },
  ],
  docsUrl: 'https://developers.google.com/google-ads/api/docs/start',

  // Where these campaigns belong in the Channel table. Without it the sync stores metrics
  // and materialises no campaigns, leaving the marketing tables empty — the failure Meta
  // Ads shipped with once.
  channel: { slug: 'google-ads', name: 'Google Ads', kind: 'paid' },

  configFields: [
    {
      name: 'customerId',
      label: 'Customer ID',
      placeholder: '123-456-7890',
      help: 'Top right in the Google Ads UI. Dashes are fine — they are stripped for you.',
      required: true,
      normalise(value) {
        const digits = customerId(value);
        if (digits.length !== 10) throw new Error('A Google Ads customer ID is ten digits, like 123-456-7890.');
        return digits;
      },
    },
    {
      name: 'loginCustomerId',
      label: 'Manager account ID',
      placeholder: '123-456-7890',
      help: 'Only when the account above is accessed through a manager (MCC). Leave blank otherwise.',
      required: false,
      normalise(value) {
        const digits = customerId(value);
        if (!digits) return '';
        if (digits.length !== 10) throw new Error('A manager account ID is ten digits.');
        return digits;
      },
    },
  ],

  isConfigured() {
    return (
      !!process.env.GOOGLE_CLIENT_ID &&
      !!process.env.GOOGLE_CLIENT_SECRET &&
      !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    );
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Google Ads uses OAuth.');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: httpTimeout(),
    });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { refresh_token?: string };
    if (!json.refresh_token) {
      throw new IntegrationError('Google returned no refresh token. Revoke access and reconnect.');
    }
    // Not validated against a customer here: the customer id is a config field, and an
    // OAuth ConnectInput carries no config. The first sync is where a wrong id surfaces,
    // with describeError naming it.
    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async sync(credential, config, range) {
    const { refreshToken } = JSON.parse(credential) as Stored;

    const customer = customerId(str(config.customerId) ?? '');
    if (!customer) throw new IntegrationError('Set the Google Ads customer ID on this integration.');
    const manager = customerId(str(config.loginCustomerId) ?? '');

    const token = await accessToken(refreshToken);

    const query = QUERY.replace('{from}', range.from.toISOString().slice(0, 10)).replace(
      '{to}',
      range.to.toISOString().slice(0, 10),
    );

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
      'content-type': 'application/json',
    };
    // Required when the customer is reached through a manager account, and rejected as an
    // unknown header if sent empty — hence set rather than always present.
    if (manager) headers['login-customer-id'] = manager;

    const res = await fetch(`${API}/customers/${customer}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      signal: httpTimeout(),
    });

    if (!res.ok) {
      throw new IntegrationError(describeError(res.status, await res.text().catch(() => '')));
    }

    // searchStream answers with an ARRAY of chunks, each carrying its own `results`, not
    // with one object. Reading `.results` off the top level returns undefined and yields a
    // silent zero-row sync — the shape mistake this endpoint invites.
    const payload = (await res.json()) as unknown;
    const chunks = Array.isArray(payload) ? (payload as Json[]) : [payload as Json];

    const points: MetricPoint[] = [];

    for (const chunk of chunks) {
      const results = Array.isArray(chunk.results) ? (chunk.results as Json[]) : [];

      for (const row of results) {
        const campaign = (row.campaign ?? {}) as Json;
        const segments = (row.segments ?? {}) as Json;
        const metrics = (row.metrics ?? {}) as Json;
        const budget = (row.campaignBudget ?? {}) as Json;
        const customerRow = (row.customer ?? {}) as Json;

        const id = str(campaign.id);
        const day = str(segments.date);
        if (!id || !day) continue;

        const date = new Date(`${day}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) continue;

        const meta = {
          status: str(campaign.status),
          startDate: str(campaign.startDate),
          endDate: str(campaign.endDate),
          // Budgets are micros too, and this one is the daily figure.
          budget: budget.amountMicros == null ? null : fromMicros(budget.amountMicros),
          budgetPeriod: budget.amountMicros == null ? null : ('daily' as const),
          // The ad account's currency, which need not be the workspace's. Pacing divides
          // budget by spend and the two have to agree.
          currency: str(customerRow.currencyCode) ?? undefined,
        };

        for (const [metricKey, value] of [
          ['spend', fromMicros(metrics.costMicros)],
          ['impressions', num(metrics.impressions)],
          ['clicks', num(metrics.clicks)],
        ] as const) {
          points.push({
            entityType: 'ad_campaign',
            entityId: id,
            entityLabel: str(campaign.name) ?? `Campaign ${id}`,
            metricKey,
            date,
            value,
            entityMeta: meta,
          });
        }
      }
    }

    return points;
  },
};
