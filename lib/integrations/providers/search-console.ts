import { IntegrationError, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Google Search Console — the first provider that actually populates the SEO tables.
//
// Semrush already reported three domain-level totals into MetricSnapshot, which is why
// the SEO page stayed seeded even with Semrush connected: nothing wrote SeoKeyword,
// SeoKeywordRanking or SeoPage. Search Console does, because it reports per-query and
// per-page rows from the site's own traffic rather than an estimate of it.
//
// The trade-off it comes with, stated plainly because it shows on the page: Search
// Console has no search volume, keyword difficulty or CPC. Those columns stay empty
// until something that has them (Semrush's keyword reports) fills them in. An average
// position from real impressions is worth more than an invented volume beside it.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

type Stored = { refreshToken: string };

/** Search Console caps a query at 25k rows. Well past what a site this size returns,
 *  and it keeps one sync inside a serverless function's budget. */
const ROW_LIMIT = 5000;

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
  });
  if (!res.ok) {
    throw new IntegrationError(
      `Google rejected the refresh token (${res.status}). Reconnect the integration.`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new IntegrationError('Google returned no access token.');
  return json.access_token;
}

type QueryRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

async function searchAnalytics(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<QueryRow[]> {
  // The property id is a URL and goes in the path, so it has to be encoded — a
  // `sc-domain:` property contains a colon and an `https://` one contains slashes.
  const res = await fetch(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rowLimit: ROW_LIMIT, ...body }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationError(
      detail?.error?.message ?? `Search Console query failed (${res.status}). Check the property.`,
    );
  }
  const json = (await res.json()) as { rows?: QueryRow[] };
  return json.rows ?? [];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Search Console dates are plain YYYY-MM-DD in the property's own timezone. */
function parseDay(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const searchConsole: IntegrationProvider = {
  id: 'google_search_console',
  name: 'Google Search Console',
  category: 'seo',
  authKind: 'oauth2',
  summary: 'Real search clicks, impressions and average position by query and page.',
  provides: ['Clicks', 'Impressions', 'CTR', 'Average position', 'Keyword rankings', 'Landing pages'],
  requiredEnv: [
    { name: 'GOOGLE_CLIENT_ID', description: 'OAuth client with the Search Console API enabled' },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'Secret for that OAuth client' },
  ],
  docsUrl: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',

  configFields: [
    {
      name: 'siteUrl',
      label: 'Property',
      placeholder: 'sc-domain:usaindiacfo.com',
      help: 'Exactly as Search Console lists it: sc-domain:example.com for a domain property, or the full https://example.com/ for a URL-prefix one.',
      required: true,
      normalise: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return trimmed;
        if (trimmed.startsWith('sc-domain:')) return trimmed;
        if (/^https?:\/\//.test(trimmed)) {
          // A URL-prefix property is an exact string match in Google's API and always
          // carries its trailing slash. Without it every query 403s with a message that
          // does not mention the slash.
          return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
        }
        // A bare domain is the common mistake, and it is unambiguous what was meant.
        if (/^[\w.-]+\.\w+$/.test(trimmed)) return `sc-domain:${trimmed}`;
        throw new Error('Use sc-domain:example.com or the full https:// URL shown in Search Console.');
      },
    },
  ],

  isConfigured() {
    return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
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
    if (input.kind !== 'oauth2') throw new IntegrationError('Search Console uses OAuth.');

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
    });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { refresh_token?: string };
    if (!json.refresh_token) {
      // Google returns a refresh token only on first consent, which is why getAuthUrl
      // forces prompt=consent.
      throw new IntegrationError('Google returned no refresh token. Revoke access and reconnect.');
    }
    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async sync(credential, config, range) {
    const siteUrl = config.siteUrl;
    if (typeof siteUrl !== 'string' || !siteUrl) {
      throw new IntegrationError('No Search Console property configured for this connection.');
    }

    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);
    const window = { startDate: iso(range.from), endDate: iso(range.to) };

    // Three shapes from the same window, because they populate three different things:
    // a daily site series for the charts, per-query rankings, and per-page performance.
    const [daily, queries, pages] = await Promise.all([
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['date'] }),
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['query', 'date'] }),
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['page'] }),
    ]);

    const points: MetricPoint[] = [];

    for (const row of daily) {
      const date = parseDay(row.keys?.[0]);
      if (!date) continue;
      const metrics: [string, number][] = [
        ['search_clicks', row.clicks ?? 0],
        ['search_impressions', row.impressions ?? 0],
        // Google reports CTR as a fraction; the rest of the app stores percentages.
        ['search_ctr', (row.ctr ?? 0) * 100],
        ['search_position', row.position ?? 0],
      ];
      for (const [metricKey, value] of metrics) {
        points.push({ entityType: 'site', entityId: null, metricKey, date, value });
      }
    }

    for (const row of queries) {
      const keyword = row.keys?.[0];
      const date = parseDay(row.keys?.[1]);
      if (!keyword || !date) continue;

      // Position is the ranking; clicks and impressions come along so the keyword table
      // can show what the ranking was actually worth.
      const metrics: [string, number][] = [
        ['position', row.position ?? 0],
        ['clicks', row.clicks ?? 0],
        ['impressions', row.impressions ?? 0],
      ];
      for (const [metricKey, value] of metrics) {
        points.push({
          entityType: 'seo_keyword',
          entityId: keyword,
          entityLabel: keyword,
          entityMeta: { keyword },
          metricKey,
          date,
          value,
        });
      }
    }

    // Pages are aggregated across the window rather than per day: SeoPage stores one
    // current row per URL, and a daily breakdown would be thrown away on write.
    const pageDate = range.to;
    for (const row of pages) {
      const url = row.keys?.[0];
      if (!url) continue;
      const metrics: [string, number][] = [
        ['clicks', row.clicks ?? 0],
        ['impressions', row.impressions ?? 0],
        ['ctr', (row.ctr ?? 0) * 100],
        ['position', row.position ?? 0],
      ];
      for (const [metricKey, value] of metrics) {
        points.push({
          entityType: 'seo_page',
          entityId: url,
          entityLabel: url,
          entityMeta: { url },
          metricKey,
          date: pageDate,
          value,
        });
      }
    }

    return points;
  },
};
