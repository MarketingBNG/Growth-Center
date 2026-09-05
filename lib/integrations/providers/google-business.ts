import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Google Business Profile — the listing, what people did with it, and what they said.
//
// The one integration here that measures intent rather than attention. A direction
// request or a call button press is somebody deciding to come to the firm; an impression
// is somebody scrolling. For a practice that takes local enquiries, those are the numbers
// worth a page.
//
// Reuses GOOGLE_CLIENT_ID, as GA4, Search Console and YouTube do.
//
// **The one thing to know before connecting it**: the Business Profile APIs are not
// simply enabled in Cloud Console like the others. Google gates them behind a per-project
// access request that a human reviews, and until it is granted every call returns 403
// with `PERMISSION_DENIED` however correct the OAuth is. That failure is caught below and
// reported as what it is, because otherwise it reads exactly like a bad credential and
// somebody spends an afternoon reissuing keys that were fine.
//
// Three APIs, because Google split this product across three hosts:
//   - Account Management, for which accounts the login can see
//   - Business Information, for the locations under an account
//   - Business Profile Performance, for the daily metrics
// Reviews live on a fourth, older host that needs its own approval, so they are not read
// here — see the note on `provides`.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERFORMANCE_API = 'https://businessprofileperformance.googleapis.com/v1';

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

/**
 * The metrics worth carrying, named as Google names them.
 *
 * Deliberately not every metric the API offers. These five are the ones a decision hangs
 * on: how the listing was found (search versus maps), and what somebody did next. The
 * rest are breakdowns of these and would fill the metrics table with rows nothing reads.
 */
const METRICS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'gbp_impressions_search_desktop',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'gbp_impressions_search_mobile',
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'gbp_impressions_maps_desktop',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'gbp_impressions_maps_mobile',
  BUSINESS_CONVERSATIONS: 'gbp_conversations',
  BUSINESS_DIRECTION_REQUESTS: 'gbp_direction_requests',
  CALL_CLICKS: 'gbp_calls',
  WEBSITE_CLICKS: 'gbp_website_clicks',
};

type Stored = { refreshToken: string };
type Json = Record<string, unknown>;

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

/**
 * A 403 from these APIs almost never means the OAuth is wrong.
 *
 * It means the Cloud project has not been granted access to the Business Profile APIs —
 * a review Google runs by hand and can take days. Reported as that, because the default
 * reading of a 403 is "bad credentials" and acting on it wastes the afternoon.
 */
function describeFailure(status: number, message: string | null): string {
  if (status === 403) {
    return (
      'Google refused the request. The Business Profile APIs need per-project access that Google grants by review — ' +
      'check the Cloud project has been approved, not the credentials. ' +
      (message ?? '')
    ).trim();
  }
  if (status === 401) return 'Google rejected the token. Reconnect the integration.';
  if (status === 429) return 'Google is rate-limiting Business Profile requests. It will resume on the next run.';
  return message ?? `Business Profile request failed (${status}).`;
}

async function get(url: string, token: string): Promise<Json> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: httpTimeout(),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationError(describeFailure(res.status, detail?.error?.message ?? null));
  }
  return (await res.json()) as Json;
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
 * Google returns a performance series as `{date: {year, month, day}, value}` with the
 * value **absent** on a day of zero rather than present as 0.
 *
 * Read carelessly that produces a metric row worth NaN, or a day silently missing from a
 * series the chart then draws a straight line across. An absent value here genuinely is
 * zero — the day happened and nothing was counted — so it is written as zero, which is
 * the opposite of the rule this codebase applies to a metric that was never measured.
 */
export function readSeries(payload: Json): { date: Date; value: number }[] {
  const series = (payload.timeSeries ?? {}) as Json;
  const dated = Array.isArray(series.datedValues) ? (series.datedValues as Json[]) : [];
  const out: { date: Date; value: number }[] = [];

  for (const entry of dated) {
    const d = (entry.date ?? {}) as Json;
    const year = Number(d.year);
    const month = Number(d.month);
    const day = Number(d.day);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;

    out.push({
      date: new Date(Date.UTC(year, month - 1, day)),
      // `?? 0`, not `Number(undefined)`. See the note above.
      value: num(entry.value ?? 0),
    });
  }
  return out;
}

/** `locations/12345` from whatever shape the caller holds. Google returns the resource
 *  name with the prefix and expects it back the same way. */
export function locationName(raw: string): string {
  // Trimmed BEFORE the prefix is stripped, not after. The other order leaves a leading
  // space in front of `locations/`, the anchored pattern misses, and the prefix is added
  // to a string that already had one — `locations/locations/123`, which 404s on every
  // call. Found by a test, not by a sync.
  const id = raw.trim().replace(/^locations\//, '');
  return `locations/${id}`;
}

export const googleBusiness: IntegrationProvider = {
  id: 'google_business',
  name: 'Google Business Profile',
  category: 'seo',
  authKind: 'oauth2',
  summary: 'How people find the listing, and what they do next — calls, directions, website clicks.',
  // Reviews are deliberately absent. They live on an older API host behind a separate
  // Google approval, and listing them here would promise a column that stays empty.
  provides: ['Search impressions', 'Maps impressions', 'Calls', 'Direction requests', 'Website clicks'],
  requiredEnv: [
    {
      name: 'GOOGLE_CLIENT_ID',
      description:
        'The same OAuth client GA4 and Search Console use — but the Cloud project additionally needs Google’s approval for the Business Profile APIs, which is a review, not a toggle.',
    },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'That client’s secret.' },
  ],
  docsUrl: 'https://developers.google.com/my-business/content/basic-setup',

  configFields: [
    {
      name: 'locationId',
      label: 'Location',
      placeholder: 'locations/1234567890',
      help: 'Left blank, the first location on the first account is used — right when the firm has one listing. Set it when there are several.',
      required: false,
      normalise(value) {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (!/^(locations\/)?\d+$/.test(trimmed)) {
          throw new Error('A location is digits, optionally prefixed with "locations/".');
        }
        return locationName(trimmed);
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
    if (input.kind !== 'oauth2') throw new IntegrationError('Google Business Profile uses OAuth.');

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

    // Resolved once, at connect. This is also where the API-approval 403 surfaces, which
    // is the right moment for it: the person is sitting in front of the screen having
    // just pressed Connect, rather than reading a cron log next week.
    const token = await accessToken(json.refresh_token);
    const location = await firstLocation(token);

    return {
      secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored),
      config: { locationId: location.name, locationTitle: location.title },
    };
  },

  async sync(credential, config, range) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    const configured = str(config.locationId);
    const location = configured ? locationName(configured) : (await firstLocation(token)).name;

    const points: MetricPoint[] = [];

    // One call per metric. Google's multi-metric endpoint returns them interleaved in a
    // shape that has to be unpicked by index, and a single metric per request is both
    // clearer and individually recoverable — one metric Google refuses does not cost the
    // other seven.
    for (const [googleName, metricKey] of Object.entries(METRICS)) {
      const params = new URLSearchParams({
        dailyMetric: googleName,
        'dailyRange.start_date.year': String(range.from.getUTCFullYear()),
        'dailyRange.start_date.month': String(range.from.getUTCMonth() + 1),
        'dailyRange.start_date.day': String(range.from.getUTCDate()),
        'dailyRange.end_date.year': String(range.to.getUTCFullYear()),
        'dailyRange.end_date.month': String(range.to.getUTCMonth() + 1),
        'dailyRange.end_date.day': String(range.to.getUTCDate()),
      });

      let payload: Json;
      try {
        payload = await get(`${PERFORMANCE_API}/${location}:getDailyMetricsTimeSeries?${params}`, token);
      } catch (e) {
        // A metric this listing does not support — CALL_CLICKS on a profile with no phone
        // number — is an absence, not a failure. An auth or approval problem is neither,
        // and is rethrown so the card reports it.
        const message = (e as Error).message;
        if (message.includes('Reconnect') || message.includes('approved')) throw e;
        continue;
      }

      for (const row of readSeries(payload)) {
        points.push({
          entityType: 'site',
          entityId: '',
          metricKey,
          date: row.date,
          value: row.value,
        });
      }
    }

    if (!points.length) {
      throw new IntegrationError(
        'Google returned no performance data for this location. A listing published in the last few days has none yet.',
      );
    }

    return points;
  },
};

/**
 * The first location on the first account the login can see.
 *
 * Two hops, because Google separates "which accounts am I on" from "what is under them",
 * and there is no endpoint that answers both.
 */
async function firstLocation(token: string): Promise<{ name: string; title: string | null }> {
  const accounts = await get(`${ACCOUNTS_API}/accounts`, token);
  const list = Array.isArray(accounts.accounts) ? (accounts.accounts as Json[]) : [];
  const account = str(list[0]?.name);
  if (!account) {
    throw new IntegrationError('This Google account manages no Business Profile. Connect the account that does.');
  }

  // readMask is required and the call fails without it — Google returns nothing by default.
  const locations = await get(
    `${INFO_API}/${account}/locations?readMask=name,title&pageSize=100`,
    token,
  );
  const found = Array.isArray(locations.locations) ? (locations.locations as Json[]) : [];
  const name = str(found[0]?.name);
  if (!name) throw new IntegrationError('That Business Profile account has no locations on it.');

  return { name: locationName(name), title: str(found[0]?.title) };
}
