import { IntegrationError, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Meta Ads insights, written per campaign so the marketing table's spend, impressions
// and clicks come from the platform rather than being entered by hand.

const GRAPH = 'https://graph.facebook.com/v21.0';

type Stored = { accessToken: string };

/**
 * Trades a token for a fresh long-lived one (~60 days).
 *
 * Used at connect, because the code exchange returns a short-lived token that would
 * die in about an hour, and again from refresh() to push the expiry out before it
 * lapses. Meta accepts a long-lived token as input here, which is what makes rolling
 * renewal possible at all.
 */
// Meta documents long-lived user tokens as ~60 days. When it omits expires_in we assume
// that rather than storing no expiry at all: a null expiry made renewIfNearExpiry() skip
// renewal entirely and the card's expiry warning never render, so the connection could
// simply stop working one morning with nothing on screen saying why. Under-estimating is
// safe — an early renewal costs one extra request.
const ASSUMED_LIFETIME_SECONDS = 60 * 24 * 60 * 60;

async function exchangeForLongLived(token: string): Promise<{ token: string; expiresIn: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID ?? '',
    client_secret: process.env.META_APP_SECRET ?? '',
    fb_exchange_token: token,
  });

  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationError(
      body?.error?.message ?? `Meta refused to extend the token (${res.status}). Reconnect.`,
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new IntegrationError('Meta returned no long-lived token.');
  return { token: json.access_token, expiresIn: json.expires_in ?? ASSUMED_LIFETIME_SECONDS };
}

export const metaAds: IntegrationProvider = {
  id: 'meta_ads',
  name: 'Meta Ads',
  category: 'ads',
  authKind: 'oauth2',
  summary: 'Facebook and Instagram ad spend, impressions and clicks by campaign.',
  provides: ['Spend', 'Impressions', 'Clicks', 'CTR', 'Campaigns'],
  requiredEnv: [
    { name: 'META_APP_ID', description: 'Meta app with ads_read permission' },
    { name: 'META_APP_SECRET', description: 'Secret for that Meta app' },
  ],
  docsUrl: 'https://developers.facebook.com/docs/marketing-api/insights',
  channel: { slug: 'meta-ads', name: 'Meta Ads', kind: 'paid' },
  configFields: [
    {
      name: 'adAccountId',
      label: 'Ad account ID',
      placeholder: 'act_1200632807599932',
      help: 'Ads Manager → account dropdown. The Graph API needs the act_ prefix; it is added for you.',
      required: true,
      // Meta shows the id bare in Business Settings but the Graph API 404s without the
      // prefix, so accept either and store the form the API wants.
      normalise: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return trimmed;
        const digits = trimmed.replace(/^act_/, '');
        if (!/^\d+$/.test(digits)) throw new Error('An ad account ID is digits, optionally prefixed with act_.');
        return `act_${digits}`;
      },
    },
  ],

  isConfigured() {
    return !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'ads_read',
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Meta Ads uses OAuth.');

    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new IntegrationError('Meta returned no access token.');

    // The code exchange yields a short-lived token — roughly an hour. Trade it up
    // immediately, or the connection would break before the first scheduled sync.
    const long = await exchangeForLongLived(json.access_token);

    return {
      secret: JSON.stringify({ accessToken: long.token } satisfies Stored),
      expiresAt: new Date(Date.now() + long.expiresIn * 1000),
    };
  },

  async refresh(credential) {
    const { accessToken } = JSON.parse(credential) as Stored;
    const long = await exchangeForLongLived(accessToken);
    return {
      secret: JSON.stringify({ accessToken: long.token } satisfies Stored),
      expiresAt: new Date(Date.now() + long.expiresIn * 1000),
    };
  },

  async sync(credential, config, range) {
    const adAccountId = config.adAccountId;
    if (typeof adAccountId !== 'string' || !adAccountId) {
      throw new IntegrationError('No ad account id configured for this connection.');
    }

    const { accessToken } = JSON.parse(credential) as Stored;
    const params = new URLSearchParams({
      access_token: accessToken,
      level: 'campaign',
      time_increment: '1',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks',
      time_range: JSON.stringify({
        since: range.from.toISOString().slice(0, 10),
        until: range.to.toISOString().slice(0, 10),
      }),
      limit: '500',
    });

    type Row = {
      campaign_id: string;
      campaign_name: string;
      date_start: string;
      spend: string;
      impressions: string;
      clicks: string;
    };

    // Meta paginates. The first response carries at most `limit` rows and a cursor;
    // reading only page one silently loses every campaign-day past it while the sync
    // still reports success. Follow paging.next until it stops.
    const rows: Row[] = [];
    let url: string | null = `${GRAPH}/${adAccountId}/insights?${params}`;

    // A guard rather than a while(true): a malformed cursor that returned itself would
    // otherwise spin until the function is killed.
    for (let page = 0; url && page < 50; page++) {
      const res: Response = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new IntegrationError(body?.error?.message ?? `Meta insights failed (${res.status}).`);
      }

      const json = (await res.json()) as { data?: Row[]; paging?: { next?: string } };
      rows.push(...(json.data ?? []));
      url = json.paging?.next ?? null;
    }

    const points: MetricPoint[] = [];
    for (const row of rows) {
      const date = new Date(`${row.date_start}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const metrics: [string, string][] = [
        ['spend', row.spend],
        ['impressions', row.impressions],
        ['clicks', row.clicks],
      ];
      for (const [metricKey, value] of metrics) {
        points.push({
          entityType: 'ad_campaign',
          entityId: row.campaign_id,
          entityLabel: row.campaign_name,
          metricKey,
          date,
          value: Number(value) || 0,
        });
      }
    }
    return points;
  },
};
