import { IntegrationError, httpTimeout, type IntegrationProvider, type MetricPoint, type SyncCursor } from '../types.ts';

// YouTube — the channel and its videos, into the same SocialAccount and SocialPost tables
// Facebook and Instagram already use. `youtube` has been in the SocialNetwork enum since
// the table was created and nothing ever wrote to it.
//
// Reuses GOOGLE_CLIENT_ID, the client GA4 and Search Console already authenticate with.
// Google, unlike Zoho, scopes per authorisation rather than per client, so a new provider
// asking for a new scope does not disturb the connections that already exist — each holds
// its own refresh token carrying its own grant.
//
// Two APIs, because one does not answer the question on its own:
//
//   - **Data API** gives the channel, its subscriber count, and each video's public
//     counters — views, likes, comments.
//   - **Analytics API** gives what only the owner can see: impressions, and how many of
//     them turned into a view. A channel's click-through rate is the number that says
//     whether the thumbnail is working, and it exists nowhere else.
//
// The second is optional at runtime. A channel too new or too small for Analytics still
// syncs its videos; the impression columns simply stay unset, which the schema already
// distinguishes from zero.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2';

/**
 * Read-only, and both halves are needed.
 *
 * `youtube.readonly` alone returns public counters — the same numbers any visitor sees.
 * `yt-analytics.readonly` is what makes this worth connecting rather than scraping.
 */
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';

/** The Data API caps a playlist page at 50. */
const PAGE = 50;

/**
 * How many of the channel's most recent videos to carry.
 *
 * The uploads playlist is every video ever published, and a channel with hundreds would
 * spend a sync walking videos nobody has watched this year. Recent work is what a
 * marketing decision is about.
 */
const MAX_VIDEOS = 200;

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

async function get(url: string, token: string): Promise<Json> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: httpTimeout(),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationError(detail?.error?.message ?? `YouTube request failed (${res.status}).`);
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
 * The channel's handle, for SocialAccount's `(network, handle)` natural key.
 *
 * Prefers the `@handle` a person would recognise and falls back to the channel id. The id
 * is stable and the handle is not — somebody can change it — so the id is what a rename
 * falls back to rather than the account silently becoming a second row.
 */
export function channelHandle(channel: Json): string | null {
  const snippet = (channel.snippet ?? {}) as Json;
  const custom = str(snippet.customUrl);
  if (custom) return custom.startsWith('@') ? custom : `@${custom}`;
  return str(channel.id);
}

type Cursor = { channelId: string; handle: string; uploads: string; pageToken: string | null; seen: number };

export function readCursor(raw: unknown): Cursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Json;
  const channelId = str(c.channelId);
  const handle = str(c.handle);
  const uploads = str(c.uploads);
  if (!channelId || !handle || !uploads) return null;

  const seen = Number(c.seen);
  return {
    channelId,
    handle,
    uploads,
    pageToken: str(c.pageToken),
    seen: Number.isFinite(seen) && seen >= 0 ? Math.floor(seen) : 0,
  };
}

/**
 * Per-video impressions and click-through rate, keyed by video id.
 *
 * Returns an empty map rather than throwing when Analytics refuses. A channel below
 * YouTube's reporting threshold, or one whose owner has not accepted the Analytics terms,
 * answers 403 here — and that must not fail a sync whose video half succeeded. The
 * columns stay unset, which the schema already reads as "not measured" rather than zero.
 */
export async function videoImpressions(
  token: string,
  channelId: string,
  from: Date,
  to: Date,
): Promise<Map<string, { impressions: number; clicks: number }>> {
  const out = new Map<string, { impressions: number; clicks: number }>();
  const params = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: from.toISOString().slice(0, 10),
    endDate: to.toISOString().slice(0, 10),
    metrics: 'annotationImpressions,views',
    dimensions: 'video',
    maxResults: '200',
    sort: '-views',
  });

  let payload: Json;
  try {
    payload = await get(`${ANALYTICS_API}/reports?${params}`, token);
  } catch {
    return out;
  }

  const rows = Array.isArray(payload.rows) ? (payload.rows as unknown[][]) : [];
  for (const row of rows) {
    const id = str(row[0]);
    if (!id) continue;
    out.set(id, { impressions: num(row[1]), clicks: num(row[2]) });
  }
  return out;
}

export const youtube: IntegrationProvider = {
  id: 'youtube',
  name: 'YouTube',
  category: 'social',
  authKind: 'oauth2',
  summary: 'The channel, its subscribers, and how each video actually performed.',
  provides: ['Subscribers', 'Views', 'Likes', 'Comments', 'Watch time'],
  requiredEnv: [
    { name: 'GOOGLE_CLIENT_ID', description: 'The same OAuth client GA4 and Search Console use, with the YouTube Data and Analytics APIs enabled.' },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'That client’s secret.' },
  ],
  docsUrl: 'https://developers.google.com/youtube/v3/docs',

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
      // Google issues a refresh token only on first consent for a client-scope pair.
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('YouTube uses OAuth.');

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

    // Checked here rather than on the first sync: an account with no channel is a
    // connection that will never report anything, and finding that out tomorrow morning
    // is finding it out too late.
    const token = await accessToken(json.refresh_token);
    const mine = await get(`${DATA_API}/channels?part=id&mine=true`, token);
    const items = Array.isArray(mine.items) ? mine.items : [];
    if (!items.length) {
      throw new IntegrationError('This Google account owns no YouTube channel. Connect the account that does.');
    }

    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async syncPaged(credential, _config, ctx) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);
    const points: MetricPoint[] = [];

    let cursor = readCursor(ctx.cursor);

    // The channel itself, on the first slice only: it is one row and it does not change
    // between pages.
    if (!cursor) {
      const payload = await get(
        `${DATA_API}/channels?part=snippet,statistics,contentDetails&mine=true`,
        token,
      );
      const channel = (Array.isArray(payload.items) ? payload.items[0] : null) as Json | null;
      if (!channel) throw new IntegrationError('YouTube returned no channel for this account.');

      const channelId = str(channel.id);
      const handle = channelHandle(channel);
      if (!channelId || !handle) throw new IntegrationError('YouTube returned a channel with no id.');

      const snippet = (channel.snippet ?? {}) as Json;
      const stats = (channel.statistics ?? {}) as Json;
      const uploads = str(
        (((channel.contentDetails ?? {}) as Json).relatedPlaylists as Json | undefined)?.uploads,
      );
      if (!uploads) throw new IntegrationError('YouTube returned no uploads playlist for this channel.');

      points.push({
        entityType: 'social_account',
        entityId: channelId,
        metricKey: 'followers',
        date: startOfDay(null),
        // The follower count IS the value on an account point — that is the contract
        // writeSocialActivity reads, not a metric key of its own.
        value: num(stats.subscriberCount),
        entityLabel: str(snippet.title) ?? handle,
        entityMeta: { network: 'youtube', handle, name: str(snippet.title) },
      });

      // Channel-wide totals, which no per-video sum reproduces: views on deleted videos
      // still count here, and the video list is capped at the most recent 200.
      for (const [key, value] of [
        ['channel_views', stats.viewCount],
        ['channel_videos', stats.videoCount],
        ['channel_subscribers', stats.subscriberCount],
      ] as const) {
        points.push({
          entityType: 'site',
          entityId: '',
          metricKey: key,
          date: startOfDay(null),
          value: num(value),
        });
      }

      cursor = { channelId, handle, uploads, pageToken: null, seen: 0 };
    }

    const impressions = await videoImpressions(token, cursor.channelId, ctx.range.from, ctx.range.to);

    while (cursor.seen < MAX_VIDEOS) {
      const params = new URLSearchParams({
        part: 'contentDetails',
        playlistId: cursor.uploads,
        maxResults: String(PAGE),
      });
      if (cursor.pageToken) params.set('pageToken', cursor.pageToken);

      const listed = await get(`${DATA_API}/playlistItems?${params}`, token);
      const items = Array.isArray(listed.items) ? (listed.items as Json[]) : [];
      const ids = items
        .map((i) => str(((i.contentDetails ?? {}) as Json).videoId))
        .filter((id): id is string => !!id);

      if (ids.length) {
        // One call for up to fifty videos rather than one call each — the Data API takes a
        // comma-separated id list, and a per-video call would be fifty round trips a page.
        const detail = await get(
          `${DATA_API}/videos?part=snippet,statistics&id=${ids.join(',')}`,
          token,
        );
        const videos = Array.isArray(detail.items) ? (detail.items as Json[]) : [];

        for (const v of videos) {
          const id = str(v.id);
          if (!id) continue;

          const snippet = (v.snippet ?? {}) as Json;
          const stats = (v.statistics ?? {}) as Json;
          const published = str(snippet.publishedAt);
          const seen = impressions.get(id);

          const base = {
            entityType: 'social_post' as const,
            entityId: id,
            date: startOfDay(published),
            entityLabel: str(snippet.title) ?? id,
            entityMeta: {
              network: 'youtube',
              handle: cursor.handle,
              publishedAt: published,
              permalink: `https://www.youtube.com/watch?v=${id}`,
              caption: str(snippet.title),
            },
          };

          // `reach` is views: it is the closest true equivalent, and it is what the Social
          // page already labels as reach for the other networks.
          points.push({ ...base, metricKey: 'reach', value: num(stats.viewCount) });
          points.push({ ...base, metricKey: 'likes', value: num(stats.likeCount) });
          points.push({ ...base, metricKey: 'comments', value: num(stats.commentCount) });

          // Only when Analytics answered. Written as absent rather than zero, because a
          // zero here would read as "nobody saw it" instead of "not measured".
          if (seen) {
            points.push({ ...base, metricKey: 'impressions', value: seen.impressions });
            points.push({ ...base, metricKey: 'clicks', value: seen.clicks });
          }
        }
      }

      cursor = { ...cursor, seen: cursor.seen + ids.length, pageToken: str(listed.nextPageToken) };

      if (!cursor.pageToken) return { points, cursor: null };
      if (Date.now() > ctx.deadline) return { points, cursor: cursor as unknown as SyncCursor };
    }

    // Reached the cap. A complete pass over what this provider undertakes to carry.
    return { points, cursor: null };
  },
};

/** Midnight UTC, which keeps a metric point's unique key stable across syncs. */
function startOfDay(value: unknown): Date {
  const raw = value == null ? '' : String(value);
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date(new Date().setUTCHours(0, 0, 0, 0));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
