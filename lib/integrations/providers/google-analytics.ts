import { IntegrationError, type IntegrationProvider, type MetricPoint } from '../types.ts';

// GA4 via the Data API. Sessions, users and conversions land in MetricSnapshot under
// entityType 'site', which is exactly what the dashboard's visitor count reads.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

type Stored = { refreshToken: string };

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
    throw new IntegrationError(`Google rejected the refresh token (${res.status}). Reconnect the integration.`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new IntegrationError('Google returned no access token.');
  return json.access_token;
}

export const googleAnalytics: IntegrationProvider = {
  id: 'google_analytics',
  name: 'Google Analytics 4',
  category: 'analytics',
  authKind: 'oauth2',
  summary: 'Website sessions, users and conversions — the top of the funnel.',
  provides: ['Sessions', 'Users', 'Pageviews', 'Conversions'],
  requiredEnv: [
    { name: 'GOOGLE_CLIENT_ID', description: 'OAuth client with the Analytics Data API enabled' },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'Secret for that OAuth client' },
  ],
  docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',

  configFields: [
    {
      name: 'propertyId',
      label: 'GA4 property ID',
      placeholder: '493812345',
      help: 'GA4 Admin → Property Settings. Digits only, not the "G-" measurement ID.',
      required: true,
      normalise: (v) => {
        const trimmed = v.trim().replace(/^properties\//, '');
        if (trimmed && !/^\d+$/.test(trimmed)) {
          throw new Error('A GA4 property ID is digits only — the G- code is a different thing.');
        }
        return trimmed;
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
    if (input.kind !== 'oauth2') throw new IntegrationError('Google Analytics uses OAuth.');

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
      // Google only returns a refresh token on the first consent, which is why
      // getAuthUrl forces prompt=consent.
      throw new IntegrationError('Google returned no refresh token. Revoke access and reconnect.');
    }
    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async sync(credential, config, range) {
    const propertyId = config.propertyId;
    if (typeof propertyId !== 'string' || !propertyId) {
      throw new IntegrationError('No GA4 property id configured for this connection.');
    }

    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [
            { startDate: range.from.toISOString().slice(0, 10), endDate: range.to.toISOString().slice(0, 10) },
          ],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
        }),
      },
    );
    if (!res.ok) {
      throw new IntegrationError(`GA4 report failed (${res.status}). Check the property id and access.`);
    }

    const json = (await res.json()) as {
      rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    };

    const keys = ['sessions', 'users', 'pageviews'];
    const points: MetricPoint[] = [];
    for (const row of json.rows ?? []) {
      const raw = row.dimensionValues[0]?.value ?? '';
      const date = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      row.metricValues.forEach((m, i) => {
        if (!keys[i]) return;
        points.push({ entityType: 'site', entityId: null, metricKey: keys[i], date, value: Number(m.value) || 0 });
      });
    }
    return points;
  },
};
