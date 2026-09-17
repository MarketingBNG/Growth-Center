import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';
import { googleAccessToken, googleAuthUrl, googleConfigured, googleExchangeCode } from './oauth.ts';

// GA4 via the Data API. Sessions, users and conversions land in MetricSnapshot under
// entityType 'site', which is exactly what the dashboard's visitor count reads.

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

type Stored = { refreshToken: string };

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

  isConfigured: googleConfigured,

  getAuthUrl(redirectUri, state) {
    return googleAuthUrl(SCOPE, redirectUri, state);
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Google Analytics uses OAuth.');
    const refreshToken = await googleExchangeCode(input.code, input.redirectUri);
    return { secret: JSON.stringify({ refreshToken } satisfies Stored) };
  },

  async sync(credential, config, range) {
    const propertyId = config.propertyId;
    if (typeof propertyId !== 'string' || !propertyId) {
      throw new IntegrationError('No GA4 property id configured for this connection.');
    }

    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await googleAccessToken(refreshToken);

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
        signal: httpTimeout(),
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
