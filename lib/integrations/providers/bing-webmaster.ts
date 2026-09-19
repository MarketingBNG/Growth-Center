import {
  IntegrationError,
  httpTimeout,
  type IntegrationProvider,
  type Json,
  type MetricPoint,
} from '../types.ts';

// Bing Webmaster Tools — the second search engine, and the one that feeds Copilot and
// ChatGPT's web results. Search Console cannot see any of it.
//
// Everything below was taken from the current documentation on 19 September 2026 rather
// than from memory, as the project rules require:
//
//   - REST shape and JSON envelope: the request samples on
//     learn.microsoft.com/en-us/dotnet/api/…iwebmasterapi.getcrawlissues —
//     `GET /webmaster/api.svc/json/<Method>?siteUrl=…&apikey=…`, Host `ssl.bing.com`,
//     every response wrapped in a `d` property.
//   - Method names: the IWebmasterApi interface listing.
//   - The crawl-issue bit values: the UrlWithCrawlIssues.CrawlIssues enum page, which is
//     `[Flags]`.
//
// NOT YET RUN AGAINST THE LIVE API. There is no Bing API key for this account, so this is
// written to the documentation and typechecked but never executed. Two things to check
// first when a key arrives, because they are the parts documentation is worst at: the
// exact date encoding in GetRankAndTrafficStats (handled defensively below), and whether
// GetCrawlIssues returns anything at all for a site with few crawl problems.

const API = 'https://ssl.bing.com/webmaster/api.svc/json';

type Stored = { apiKey: string };

/**
 * One GET against the JSON endpoint.
 *
 * Bing answers errors with a 200 and a fault body about as often as with a status code, so
 * the envelope is checked as well as `res.ok`.
 */
async function call(apiKey: string, method: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ ...params, apikey: apiKey });
  const res = await fetch(`${API}/${method}?${query}`, {
    headers: { accept: 'application/json' },
    signal: httpTimeout(),
  });

  if (res.status === 401 || res.status === 403) {
    throw new IntegrationError('Bing rejected the API key. Generate a new one in Webmaster Tools → Settings → API Access.');
  }
  if (!res.ok) {
    throw new IntegrationError(`Bing Webmaster returned ${res.status} for ${method}.`);
  }

  const body = (await res.json()) as Json;
  // A WCF fault comes back as a 200 with a Message rather than a `d`.
  if (body && typeof body === 'object' && 'Message' in body && !('d' in body)) {
    throw new IntegrationError(`Bing Webmaster refused ${method}: ${String(body.Message)}`);
  }
  return (body as { d?: unknown }).d;
}

const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

const numberOf = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Bing's dates, whatever form they arrive in.
 *
 * `api.svc` is a WCF service and WCF serialises DateTime as `/Date(1600000000000+0000)/`
 * — milliseconds since the epoch wrapped in a string, sometimes with a timezone offset
 * glued on. Some endpoints have been observed returning plain ISO instead, and the
 * documentation shows neither, so both are accepted and anything else is dropped rather
 * than becoming an epoch row.
 *
 * Normalised to midnight UTC: these are daily figures, and a timestamp would put the same
 * day in two buckets.
 */
export function parseBingDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;

  const wcf = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  const parsed = wcf ? new Date(Number(wcf[1])) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/**
 * The `Issues` field, which JSON gives as a number and XML as a name.
 *
 * `[Flags]`, so one URL routinely carries several at once — a 404 that is also blocked by
 * robots.txt is 4 | 16 = 20. Stored as names because "20" in a database is a number
 * nobody can act on, and the mapping lives here rather than in the reader.
 */
export const CRAWL_ISSUE_FLAGS: [number, string][] = [
  [1, 'Redirect 301'],
  [2, 'Redirect 302'],
  [4, 'HTTP 4xx'],
  [8, 'HTTP 5xx'],
  [16, 'Blocked by robots.txt'],
  [32, 'Contains malware'],
  [64, 'Important URL blocked by robots.txt'],
  [128, 'DNS error'],
  [256, 'Timeout'],
];

export function decodeCrawlIssues(mask: unknown): string[] {
  const bits = Number(mask);
  if (!Number.isFinite(bits) || bits <= 0) return [];
  return CRAWL_ISSUE_FLAGS.filter(([bit]) => (bits & bit) !== 0).map(([, name]) => name);
}

export const bingWebmaster: IntegrationProvider = {
  id: 'bing_webmaster',
  name: 'Bing Webmaster Tools',
  category: 'seo',
  authKind: 'apiKey',
  summary: 'Bing clicks, impressions and crawl problems — the half of search Google cannot report.',
  provides: ['Bing clicks', 'Bing impressions', 'Crawl issues', 'Indexed pages'],
  // The key is entered in the UI and sealed, like Smartlead and PageSpeed. Nothing in the
  // environment, nothing in Vercel.
  requiredEnv: [],
  docsUrl: 'https://learn.microsoft.com/en-us/bingwebmaster/getting-access',

  configFields: [
    {
      name: 'siteUrl',
      label: 'Verified site',
      placeholder: 'https://usaindiacfo.com',
      help: 'Exactly as Bing Webmaster Tools lists it. The site must already be verified under the account the key belongs to.',
      required: true,
      normalise: (v) => {
        const trimmed = v.trim().replace(/\/+$/, '');
        if (!trimmed) return trimmed;
        if (/^https?:\/\//.test(trimmed)) return trimmed;
        if (/^[\w.-]+\.\w+$/.test(trimmed)) return `https://${trimmed}`;
        throw new Error('Give the full site URL, e.g. https://usaindiacfo.com');
      },
    },
  ],

  // A key is all it needs, and that arrives through the connect form.
  isConfigured: () => true,

  getAuthUrl: () => null,

  async connect(input) {
    if (input.kind !== 'apiKey') throw new IntegrationError('Bing Webmaster uses an API key.');
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new IntegrationError('Enter the API key from Webmaster Tools → Settings → API Access.');

    // Validated against the account's own site list rather than a ping: a key that is
    // valid but has no access to the configured site fails on the first sync otherwise,
    // hours later and somewhere nobody is looking.
    const sites = asArray(await call(apiKey, 'GetUserSites', {}));
    const configured = String(input.config?.siteUrl ?? '').replace(/\/+$/, '');
    if (configured) {
      const known = sites.map((s) => String(s.Url ?? '').replace(/\/+$/, ''));
      if (known.length && !known.includes(configured)) {
        throw new IntegrationError(
          `That key has no access to ${configured}. It can see: ${known.join(', ') || 'no sites at all'}.`,
        );
      }
    }

    return { secret: JSON.stringify({ apiKey } satisfies Stored), config: input.config };
  },

  async sync(credential, config, range) {
    const siteUrl = config.siteUrl;
    if (typeof siteUrl !== 'string' || !siteUrl) {
      throw new IntegrationError('No Bing Webmaster site configured for this connection.');
    }
    const { apiKey } = JSON.parse(credential) as Stored;

    const [traffic, issues] = await Promise.all([
      call(apiKey, 'GetRankAndTrafficStats', { siteUrl }),
      call(apiKey, 'GetCrawlIssues', { siteUrl }),
    ]);

    const points: MetricPoint[] = [];

    // ── Daily clicks and impressions ─────────────────────────────────────────────
    //
    // entityType `site_bing`, NOT `site`. Search Console already writes `search_clicks`
    // against `site` for the same dates, and metric_snapshot is unique on
    // (source, entityType, entityId, metricKey, date) — the differing source means both
    // rows are allowed to exist, and readSearchTrend in lib/analytics/seo.ts selects on
    // entityType alone and ASSIGNS rather than sums. Two engines under one entity type
    // would make the SEO trend show whichever provider synced last.
    for (const row of asArray(traffic)) {
      const date = parseBingDate(row.Date);
      if (!date) continue;
      // Bing only reports days inside its own retention; anything outside the requested
      // window is dropped so a sync cannot widen its own range.
      if (date < range.from || date > range.to) continue;

      points.push(
        { entityType: 'site_bing', entityId: 'bing', metricKey: 'bing_clicks', date, value: numberOf(row.Clicks) },
        { entityType: 'site_bing', entityId: 'bing', metricKey: 'bing_impressions', date, value: numberOf(row.Impressions) },
      );
    }

    // ── Crawl issues ─────────────────────────────────────────────────────────────
    //
    // entityType `seo_page_bing` for the same reason, and a second one specific to this
    // table: writeSeoRows builds a whole SeoPage per `seo_page` point and defaults clicks,
    // impressions, CTR and position to zero, so routing anything but Search Console
    // traffic through that type wipes real traffic off every URL it touches. PageSpeed
    // already had to learn this.
    //
    // Dated to the end of the window rather than per day: Bing reports the issues standing
    // now, not a history, and the documentation notes a fixed issue takes a few days to
    // drop off the list.
    for (const row of asArray(issues)) {
      const url = typeof row.Url === 'string' ? row.Url : null;
      if (!url) continue;
      const names = decodeCrawlIssues(row.Issues);
      if (!names.length) continue;

      points.push({
        entityType: 'seo_page_bing',
        entityId: url,
        entityLabel: url,
        entityMeta: {
          url,
          issues: names,
          httpCode: numberOf(row.HttpCode) || null,
          inLinks: numberOf(row.InLinks),
        },
        metricKey: 'crawl_issues',
        date: range.to,
        value: names.length,
      });
    }

    return points;
  },
};
