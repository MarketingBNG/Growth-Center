import { IntegrationError, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Facebook Page and Instagram Business organic performance — the Social page's numbers.
//
// Deliberately separate from meta_ads even though both talk to the same Graph API and
// can sit on the same Meta app. They are different products with different permissions:
// ads_read grants nothing on a Page's organic posts, and a team that only runs ads
// should not be pushed through Page review to get their campaign spend. Keeping them
// apart also means one failing app review does not take the other down.
//
// Read-only on purpose. There is no publishing here and no scope requested for it —
// posting would need content permissions, a review of its own, and a scheduling model
// the app does not have.

const GRAPH = 'https://graph.facebook.com/v21.0';

type Stored = { accessToken: string };

// Matches meta-ads: Meta documents long-lived user tokens as ~60 days and sometimes
// omits expires_in. Assuming the documented lifetime keeps the card's expiry warning
// working rather than storing a null that disables renewal entirely.
const ASSUMED_LIFETIME_SECONDS = 60 * 24 * 60 * 60;

/** How many recent posts to pull per account. Insights are one request per post, so this
 *  is the main cost of a sync; a month of normal posting sits well inside it. */
const POST_LIMIT = 50;

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

async function failed(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new IntegrationError(body?.error?.message ?? `Meta request failed (${res.status}).`);
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  if (!res.ok) await failed(res);
  return (await res.json()) as T;
}

/** Hard stop on cursor-following, so a repeating or circular `paging.next` cannot spin
 *  forever. At POST_LIMIT rows a page this is far more history than any range asks for. */
const MAX_PAGES = 20;

/**
 * Follows Graph's `paging.next` cursor and returns every row.
 *
 * Graph caps a page well below what a busy account posts in a month, and a single
 * request silently drops the rest. Truncated totals are worse than an error here: the
 * Social page renders them as a real decline in reach rather than as missing rows.
 *
 * `stop` lets a caller quit early once a page has walked past the window it wants —
 * necessary because not every edge honours `since`/`until` (see the media call below).
 */
async function graphPaged<T>(
  path: string,
  params: Record<string, string>,
  stop?: (rows: T[]) => boolean,
): Promise<T[]> {
  const out: T[] = [];
  // The cursor URL carries the token and the field list already, so it is followed
  // verbatim rather than rebuilt.
  let url = `${GRAPH}/${path}?${new URLSearchParams(params)}`;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url);
    if (!res.ok) await failed(res);
    const json = (await res.json()) as { data?: T[]; paging?: { next?: string } };
    const rows = json.data ?? [];
    out.push(...rows);

    const next = json.paging?.next;
    if (!rows.length || !next || stop?.(rows)) break;
    url = next;
  }
  return out;
}

type InsightPayload = { data?: { name: string; values?: { value?: unknown }[] }[] };

/**
 * Flattens a Graph insights payload.
 *
 * Values arrive as `{name, values: [{value}]}`, and lifetime metrics carry more than one
 * entry. Taking the last is what "as of now" means for a follower count and is harmless
 * for the single-entry period metrics.
 */
export function insightValues(payload: InsightPayload): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of payload.data ?? []) {
    const last = metric.values?.at(-1)?.value;
    if (typeof last === 'number') out[metric.name] = last;
  }
  return out;
}

/** Graph timestamps look like 2026-08-24T11:02:30+0000. A missing or malformed one must
 *  not become an Invalid Date on a row we are about to write. */
export function parseTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

type PageRow = {
  id: string;
  name?: string;
  username?: string;
  access_token?: string;
  fan_count?: number;
  followers_count?: number;
  instagram_business_account?: { id: string; username?: string; name?: string; followers_count?: number };
};

type PostRow = {
  id: string;
  message?: string;
  caption?: string;
  permalink?: string;
  permalink_url?: string;
  created_time?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  /** Facebook's only share figure, and it is a bare count rather than an insight. */
  shares?: { count?: number };
};

type Network = 'facebook' | 'instagram';

/**
 * Whether a post falls inside the requested window.
 *
 * Needed because `{ig-user-id}/media` accepts `since`/`until` and then ignores them —
 * Graph does not error, it just returns the newest media whatever was asked for. Left
 * unfiltered, Instagram reported a different window from Facebook in the same sync and
 * the two networks' totals could not be compared.
 */
export function inRange(at: Date, range: { from: Date; to: Date }): boolean {
  return at >= range.from && at <= range.to;
}

/** True once a page of newest-first media has reached past the start of the window, so
 *  nothing older is left worth fetching. */
export function walkedPast(rows: { timestamp?: string }[], from: Date): boolean {
  return rows.some((r) => {
    const at = parseTime(r.timestamp);
    return at !== null && at < from;
  });
}

/** Drops keys the platform did not report, so an unmeasured metric keeps its column
 *  default instead of being written as a real zero. */
export function measured(metrics: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) if (typeof value === 'number') out[key] = value;
  return out;
}

/** A follower count for one account. Both networks build it the same way, so the Social
 *  page cannot tell which came from where. */
function accountPoint(
  network: Network,
  handle: string,
  name: string | undefined,
  followers: number,
  at: Date,
): MetricPoint {
  return {
    entityType: 'social_account',
    // Namespaced by network: the same handle exists on both, and SocialAccount is unique
    // on (network, handle) rather than handle alone.
    entityId: `${network}:${handle}`,
    entityLabel: name ?? handle,
    entityMeta: { network, handle, name: name ?? null },
    metricKey: 'followers',
    date: at,
    value: followers,
  };
}

function postPoints(
  network: Network,
  handle: string,
  post: PostRow,
  publishedAt: Date,
  metrics: Record<string, number>,
): MetricPoint[] {
  const meta = {
    network,
    handle,
    permalink: post.permalink ?? post.permalink_url ?? null,
    caption: post.caption ?? post.message ?? null,
    publishedAt: publishedAt.toISOString(),
  };

  return Object.entries(metrics).map(([metricKey, value]) => ({
    entityType: 'social_post',
    entityId: post.id,
    entityLabel: meta.caption ?? post.id,
    entityMeta: meta,
    metricKey,
    // The post's own publish date, not the sync date: a post's reach belongs to the day
    // it went out, which is what makes the recent-posts table orderable from these rows.
    date: publishedAt,
    value,
  }));
}

export const metaSocial: IntegrationProvider = {
  id: 'meta_social',
  name: 'Facebook & Instagram',
  category: 'social',
  authKind: 'oauth2',
  summary: 'Organic Page and Instagram followers, reach and engagement by post.',
  provides: ['Followers', 'Reach', 'Impressions', 'Likes', 'Comments', 'Shares', 'Saves'],
  requiredEnv: [
    { name: 'META_APP_ID', description: 'Meta app with Page and Instagram permissions' },
    { name: 'META_APP_SECRET', description: 'Secret for that Meta app' },
  ],
  docsUrl: 'https://developers.facebook.com/docs/graph-api/reference/page/insights',

  isConfigured() {
    return !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      // Read scopes only. instagram_manage_insights reads as a write permission but is
      // what Meta requires to read Instagram media insights at all.
      scope: [
        'pages_show_list',
        'pages_read_engagement',
        'read_insights',
        'instagram_basic',
        'instagram_manage_insights',
      ].join(','),
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Facebook & Instagram uses OAuth.');

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
    // immediately, or the connection breaks before the first scheduled sync.
    const long = await exchangeForLongLived(json.access_token);

    // Fail here rather than at the first sync. Someone can complete the whole consent
    // screen while granting no Page, and a card reading "connected" that can never
    // return a row is the exact state this codebase keeps trying to eliminate.
    const pages = await graph<{ data?: PageRow[] }>('me/accounts', {
      access_token: long.token,
      fields: 'id,name',
      limit: '1',
    });
    if (!pages.data?.length) {
      throw new IntegrationError(
        'No Facebook Page was granted. Reconnect and tick the Page whose insights you want.',
      );
    }

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

  async sync(credential, _config, range) {
    const { accessToken } = JSON.parse(credential) as Stored;
    const since = String(Math.floor(range.from.getTime() / 1000));
    const until = String(Math.floor(range.to.getTime() / 1000));
    const now = new Date();

    const pages = await graphPaged<PageRow>('me/accounts', {
      access_token: accessToken,
      // The Page access token comes back on this call. Page and media insights will not
      // accept the user token, so it is read here rather than requested per page.
      fields:
        'id,name,username,access_token,fan_count,followers_count,instagram_business_account{id,username,name,followers_count}',
      limit: '100',
    });

    const points: MetricPoint[] = [];

    for (const page of pages) {
      const pageToken = page.access_token ?? accessToken;
      const handle = page.username ?? page.id;

      points.push(
        accountPoint('facebook', handle, page.name, page.followers_count ?? page.fan_count ?? 0, now),
      );

      // ── Facebook Page posts ──────────────────────────────────────────────────────
      // This edge does honour since/until, so the window is applied server-side.
      const posts = await graphPaged<PostRow>(`${page.id}/posts`, {
        access_token: pageToken,
        fields:
          'id,message,permalink_url,created_time,shares,likes.summary(true).limit(0),comments.summary(true).limit(0)',
        since,
        until,
        limit: String(POST_LIMIT),
      });

      for (const post of posts) {
        const publishedAt = parseTime(post.created_time);
        if (!publishedAt) continue;

        // Per-post insights are a separate call, and Meta refuses them on some post
        // types. One post failing must not abandon the sync — the account's other posts
        // are still worth writing, and the engagement counts below survive either way.
        const ins = insightValues(
          await graph<InsightPayload>(`${post.id}/insights`, {
            access_token: pageToken,
            metric: 'post_impressions_unique,post_impressions,post_clicks',
          }).catch(() => ({})),
        );

        points.push(
          ...postPoints(
            'facebook',
            handle,
            post,
            publishedAt,
            // Only what came back: a swallowed insights error must not be written as a
            // post that genuinely reached nobody.
            measured({
              reach: ins.post_impressions_unique,
              impressions: ins.post_impressions,
              clicks: ins.post_clicks,
              // Facebook reports these as edge summaries rather than insights, so they
              // arrive on the post itself.
              likes: post.likes?.summary?.total_count,
              comments: post.comments?.summary?.total_count,
              shares: post.shares?.count,
            }),
          ),
        );
      }

      // ── the Instagram account attached to this Page ──────────────────────────────
      const ig = page.instagram_business_account;
      if (!ig) continue;

      const igHandle = ig.username ?? ig.id;
      const igProfile = await graph<{ followers_count?: number; name?: string }>(ig.id, {
        access_token: pageToken,
        fields: 'followers_count,username,name',
      }).catch(() => ({}) as { followers_count?: number; name?: string });

      points.push(
        accountPoint(
          'instagram',
          igHandle,
          ig.name ?? igProfile.name,
          igProfile.followers_count ?? ig.followers_count ?? 0,
          now,
        ),
      );

      // No since/until here: this edge accepts them and ignores them. The window is
      // applied below instead, and paging stops as soon as a page reaches past its start.
      const media = await graphPaged<PostRow>(
        `${ig.id}/media`,
        {
          access_token: pageToken,
          fields: 'id,caption,permalink,timestamp,like_count,comments_count',
          limit: String(POST_LIMIT),
        },
        (rows) => walkedPast(rows, range.from),
      );

      for (const post of media) {
        const publishedAt = parseTime(post.timestamp);
        if (!publishedAt || !inRange(publishedAt, range)) continue;

        // Split in two on purpose. `views` replaced `impressions` for media published
        // after mid-2024 and the old name now errors — asked for in one combined call it
        // would take reach and saves down with it and report the post as never seen.
        const [core, viewed] = await Promise.all([
          graph<InsightPayload>(`${post.id}/insights`, {
            access_token: pageToken,
            metric: 'reach,saved',
          }).catch(() => ({})),
          graph<InsightPayload>(`${post.id}/insights`, {
            access_token: pageToken,
            metric: 'views',
          }).catch(() =>
            // Older media predate `views` and still answer to `impressions`.
            graph<InsightPayload>(`${post.id}/insights`, {
              access_token: pageToken,
              metric: 'impressions',
            }).catch(() => ({})),
          ),
        ]);
        const ins = { ...insightValues(core), ...insightValues(viewed) };

        points.push(
          ...postPoints(
            'instagram',
            igHandle,
            post,
            publishedAt,
            measured({
              reach: ins.reach,
              impressions: ins.views ?? ins.impressions,
              likes: post.like_count,
              comments: post.comments_count,
              // Saves get their own column. They were previously written as `shares`,
              // which inflated Instagram's engagement against Facebook's and named an
              // action nobody took — Instagram reports no share count for organic media,
              // so that key is simply absent here.
              saves: ins.saved,
              // No link-clicks metric exists for organic Instagram media either, so
              // `clicks` is omitted and the column keeps its default.
            }),
          ),
        );
      }
    }

    if (!points.length) {
      throw new IntegrationError(
        'Meta returned no Page or Instagram data. Check the Page is granted and has posts in this window.',
      );
    }
    return points;
  }
};
