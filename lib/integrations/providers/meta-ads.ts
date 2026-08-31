import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';

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

  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`, { signal: httpTimeout() });
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
    const res = await fetch(`${GRAPH}/oauth/access_token?${params}`, { signal: httpTimeout() });
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
      const res: Response = await fetch(url, { signal: httpTimeout() });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new IntegrationError(body?.error?.message ?? `Meta insights failed (${res.status}).`);
      }

      const json = (await res.json()) as { data?: Row[]; paging?: { next?: string } };
      rows.push(...(json.data ?? []));
      url = json.paging?.next ?? null;
    }

    // Insights report performance and nothing else, so a campaign's own schedule, budget
    // and status were never fetched and those four columns stayed null on every campaign.
    // One extra request for the whole account, not one per campaign.
    const details = await campaignDetails(adAccountId, accessToken);

    // The account's billing currency. Spend arrives as a bare number, and this account
    // bills in INR while most of the revenue it is compared against is in USD — without
    // this every rupee was stored and rendered as a dollar.
    const currency = await accountCurrency(adAccountId, accessToken);

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
          entityMeta: { ...details.get(row.campaign_id), currency },
        });
      }
    }
    return points;
  },
};

type CampaignDetail = {
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  budgetPeriod: 'daily' | 'lifetime' | null;
};

/**
 * A campaign's schedule, budget and status, which the insights edge does not carry.
 *
 * Budget is reported in minor units — 5000 means £50.00 — and a campaign carries either a
 * daily or a lifetime one, never both. The daily figure is preferred because it is what
 * the account is actually pacing to; a lifetime budget stands in when there is no daily.
 *
 * Which of the two it was is recorded alongside it. Without that the number is not
 * comparable to a period's spend: a daily budget has to be multiplied by the days the
 * campaign ran before the division means anything.
 *
 * A failure here is not a failure of the sync. Spend is the number every ROAS and CAC
 * figure depends on and it has already been fetched; losing a start date is worth far
 * less than losing the run.
 */
async function campaignDetails(
  adAccountId: string,
  accessToken: string,
): Promise<Map<string, CampaignDetail>> {
  const out = new Map<string, CampaignDetail>();
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'id,status,start_time,stop_time,daily_budget,lifetime_budget',
    limit: '500',
  });

  type Row = {
    id: string;
    status?: string;
    start_time?: string;
    stop_time?: string;
    daily_budget?: string;
    lifetime_budget?: string;
  };

  let url: string | null = `${GRAPH}/${adAccountId}/campaigns?${params}`;
  try {
    for (let page = 0; url && page < 50; page++) {
      const res: Response = await fetch(url, { signal: httpTimeout() });
      if (!res.ok) return out;

      const json = (await res.json()) as { data?: Row[]; paging?: { next?: string } };
      for (const row of json.data ?? []) {
        const daily = Number(row.daily_budget);
        const hasDaily = Number.isFinite(daily) && daily > 0;
        const minorUnits = hasDaily ? daily : Number(row.lifetime_budget);
        const budget = Number.isFinite(minorUnits) && minorUnits > 0 ? minorUnits / 100 : null;
        out.set(row.id, {
          status: row.status?.toLowerCase() ?? null,
          startDate: row.start_time ?? null,
          endDate: row.stop_time ?? null,
          budget,
          budgetPeriod: budget === null ? null : hasDaily ? 'daily' : 'lifetime',
        });
      }
      url = json.paging?.next ?? null;
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * The currency the ad account bills in.
 *
 * Fails the sync rather than assuming USD, which is what this did before.
 *
 * The old comment argued a wrong label was "visible and correctable" and a lost sync was
 * not. That was wrong, and the account proved it: the lookup failed, 221 days of rupee
 * spend were stored as dollars, and the Marketing page rendered ₹498,000 of real spend as
 * ₹40,391,906 — inflated by the exchange rate, in the workspace's own currency symbol,
 * with nothing anywhere to say it was a guess. Nobody corrects a number that looks like a
 * number. A sync that stops with a message naming the missing permission does get fixed.
 */
async function accountCurrency(adAccountId: string, accessToken: string): Promise<string> {
  let json: { currency?: string };
  try {
    const res = await fetch(
      `${GRAPH}/${adAccountId}?fields=currency&access_token=${encodeURIComponent(accessToken)}`,
      { signal: httpTimeout() },
    );
    if (!res.ok) {
      throw new IntegrationError(
        `Meta would not report the billing currency for ${adAccountId} (HTTP ${res.status}). ` +
          'Spend cannot be stored without it. The token usually needs the ads_read permission.',
      );
    }
    json = (await res.json()) as { currency?: string };
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError(
      `Could not reach Meta to read the billing currency for ${adAccountId}. Spend cannot be stored without it.`,
    );
  }

  const currency = json.currency?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new IntegrationError(
      `Meta reported no billing currency for ${adAccountId}. Spend cannot be stored without it.`,
    );
  }
  return currency;
}
