import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint } from '../types.ts';
import { vendorMessage } from '../messages.ts';
import { googleAccessToken, googleAuthUrl, googleConfigured, googleExchangeCode } from './oauth.ts';

// Google Search Console — the provider that populates the SEO tables. It reports
// per-query and per-page rows from the site's own traffic rather than an estimate of it,
// which is what makes SeoKeyword, SeoKeywordRanking and SeoPage real.
//
// The trade-off it comes with, stated plainly because it shows on the page: Search
// Console has no search volume, keyword difficulty or CPC, so those columns stay empty.
// An average position from real impressions is worth more than an invented volume.

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

type Stored = { refreshToken: string };

/** Search Console caps a query at 25k rows. Well past what a site this size returns,
 *  and it keeps one sync inside a serverless function's budget. */
const ROW_LIMIT = 5000;

type QueryRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

/**
 * The two markets the firm sells into, as Search Console spells a country — ISO 3166-1
 * alpha-3, lower case.
 *
 * The breakdown is asked for one country at a time rather than by adding `country` to the
 * existing calls, for two reasons. A page's rows would otherwise be multiplied by every
 * country that has ever seen it — mostly a handful of impressions from places the firm
 * does not sell — and the 5000-row cap would be spent on them before the rows that matter.
 * And the split the business actually asks for is US against India: Indian founders
 * expanding to the US, and NRIs already living there. Everywhere else is one bucket nobody
 * reads.
 */
const TRACKED_COUNTRIES = ['usa', 'ind'] as const;

/** Restricts a query to one country. */
const inCountry = (country: string) => ({
  dimensionFilterGroups: [
    { filters: [{ dimension: 'country', operator: 'equals', expression: country }] },
  ],
});

/**
 * How a country-scoped row is addressed in `metric_snapshot.entityId`.
 *
 * Country first and split on the *first* separator, because a URL may legally contain a
 * pipe and a country code never can.
 */
export const countryKey = (country: string, entity: string) => `${country}|${entity}`;
export function splitCountryKey(key: string): { country: string; entity: string } {
  const at = key.indexOf('|');
  return at === -1
    ? { country: key, entity: '' }
    : { country: key.slice(0, at), entity: key.slice(at + 1) };
}

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
    signal: httpTimeout(),
  });
  if (!res.ok) {
    throw new IntegrationError(
      (await vendorMessage(res)) ??
        `Search Console query failed (${res.status}). Check the property.`,
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
  provides: [
    'Clicks',
    'Impressions',
    'CTR',
    'Average position',
    'Keyword rankings',
    'Landing pages',
    'US / India split',
    'Device split',
  ],
  requiredEnv: [
    { name: 'GOOGLE_CLIENT_ID', description: 'OAuth client with the Search Console API enabled' },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'Secret for that OAuth client' },
  ],
  docsUrl: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',

  configFields: [
    {
      name: 'siteUrl',
      label: 'Property',
      placeholder: 'https://usaindiacfo.com/',
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

  isConfigured: googleConfigured,

  getAuthUrl(redirectUri, state) {
    return googleAuthUrl(SCOPE, redirectUri, state);
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Search Console uses OAuth.');
    const refreshToken = await googleExchangeCode(input.code, input.redirectUri);
    return { secret: JSON.stringify({ refreshToken } satisfies Stored) };
  },

  async sync(credential, config, range) {
    const siteUrl = config.siteUrl;
    if (typeof siteUrl !== 'string' || !siteUrl) {
      throw new IntegrationError('No Search Console property configured for this connection.');
    }

    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await googleAccessToken(refreshToken);
    const window = { startDate: iso(range.from), endDate: iso(range.to) };

    // Three shapes from the same window, because they populate three different things:
    // a daily site series for the charts, per-query rankings, and per-page performance.
    const [daily, queries, pages, landing] = await Promise.all([
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['date'] }),
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['query', 'date'] }),
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['page'] }),
      // A fourth shape only to answer "which page ranks for this?" — the ranking table
      // had a url column that nothing ever filled, because query and page were asked for
      // separately and neither answer knows about the other.
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['query', 'page'] }),
    ]);

    // The page that earns the most impressions for a term is the one that ranks for it.
    // Clicks would be the wrong test: a term can rank well and be clicked rarely, and the
    // page that happened to win one click is not the page that holds the position.
    const pageForQuery = new Map<string, { url: string; impressions: number }>();
    for (const row of landing) {
      const keyword = row.keys?.[0];
      const url = row.keys?.[1];
      if (!keyword || !url) continue;
      const impressions = row.impressions ?? 0;
      const best = pageForQuery.get(keyword);
      if (!best || impressions > best.impressions) pageForQuery.set(keyword, { url, impressions });
    }

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
          entityMeta: { keyword, url: pageForQuery.get(keyword)?.url ?? null },
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

    // ── Country and device breakdowns ─────────────────────────────────────────
    //
    // Separate entity types, not a country dimension added to the `site`, `seo_page` and
    // `seo_keyword` points above. Those three are read by code that filters on entityType
    // and never on entityId: readSearchTrend in lib/analytics/seo.ts assigns
    // `day.clicks = value` for each row of a day, and the traffic totals sum every
    // `seo_keyword` row there is. Country rows under those types would make the trend
    // report whichever country happened to be written last, and double every total. A
    // type of its own is invisible to both, and to the materialiser in writers/seo.ts,
    // which matches entityType exactly and so will not mint duplicate SeoPage rows.
    const [byCountry, devices] = await Promise.all([
      Promise.all(
        TRACKED_COUNTRIES.map(async (country) => {
          const scope = inCountry(country);
          const [days, terms, urls] = await Promise.all([
            searchAnalytics(token, siteUrl, { ...window, dimensions: ['date'], ...scope }),
            searchAnalytics(token, siteUrl, { ...window, dimensions: ['query'], ...scope }),
            searchAnalytics(token, siteUrl, { ...window, dimensions: ['page'], ...scope }),
          ]);
          return { country, days, terms, urls };
        }),
      ),
      searchAnalytics(token, siteUrl, { ...window, dimensions: ['date', 'device'] }),
    ]);

    /** clicks, impressions, CTR and position off one row, in that order. */
    const figures = (row: QueryRow, prefix: '' | 'search_'): [string, number][] => [
      [`${prefix}clicks`, row.clicks ?? 0],
      [`${prefix}impressions`, row.impressions ?? 0],
      [`${prefix}ctr`, (row.ctr ?? 0) * 100],
      [`${prefix}position`, row.position ?? 0],
    ];

    for (const { country, days, terms, urls } of byCountry) {
      for (const row of days) {
        const date = parseDay(row.keys?.[0]);
        if (!date) continue;
        for (const [metricKey, value] of figures(row, 'search_')) {
          points.push({ entityType: 'site_country', entityId: country, metricKey, date, value });
        }
      }

      // Queries and pages are aggregated across the window, matching the `seo_page` rows
      // above: the question these answer is "how does this page do in India versus the
      // US", which is a period figure, not a daily series.
      for (const row of terms) {
        const keyword = row.keys?.[0];
        if (!keyword) continue;
        for (const [metricKey, value] of figures(row, '')) {
          points.push({
            entityType: 'seo_keyword_country',
            entityId: countryKey(country, keyword),
            entityLabel: keyword,
            entityMeta: { keyword, country },
            metricKey,
            date: pageDate,
            value,
          });
        }
      }

      for (const row of urls) {
        const url = row.keys?.[0];
        if (!url) continue;
        for (const [metricKey, value] of figures(row, '')) {
          points.push({
            entityType: 'seo_page_country',
            entityId: countryKey(country, url),
            entityLabel: url,
            entityMeta: { url, country },
            metricKey,
            date: pageDate,
            value,
          });
        }
      }
    }

    // Device needs no country filter and no per-page grain: three values a day, kept as a
    // daily series because the thing worth seeing is mobile's share moving over time.
    for (const row of devices) {
      const date = parseDay(row.keys?.[0]);
      const device = row.keys?.[1]?.toLowerCase();
      if (!date || !device) continue;
      for (const [metricKey, value] of figures(row, 'search_')) {
        points.push({ entityType: 'site_device', entityId: device, metricKey, date, value });
      }
    }

    return points;
  },
};
