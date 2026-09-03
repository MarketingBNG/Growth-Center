import { db } from '../prisma.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { hasEncryptionKey, open, seal } from '../crypto.ts';
import { dispatch } from '../events.ts';
import { channelSlugFor, cleanImportedName, leadSourceType, leadStatus, matchStage, taskPriority, taskStatus } from './crm-mapping.ts';
import { normalizeCompanyName } from '../dedupe.ts';
import { currencySettings } from '../settings.ts';
import { prospectStatus as prospectStatusOf } from './providers/smartlead.ts';
import { getProvider, providerList } from './registry.ts';
import {
  IntegrationError,
  type ConfigField,
  type ConnectInput,
  type DateRange,
  type MetricPoint,
  type SyncCursor,
  type SyncResult,
} from './types.ts';
import { TAGS, cached } from '../cache.ts';

// Everything that reads or writes integration state goes through here, so the rule
// "state is read from the row, never inferred" holds in one place.

export type Card = {
  id: string;
  name: string;
  category: string;
  authKind: string;
  summary: string;
  provides: string[];
  docsUrl?: string;
  state: string;
  /** True only when a sealed credential row actually exists. */
  hasCredential: boolean;
  configured: boolean;
  missingEnv: { name: string; description: string }[];
  /** Declared by the provider; rendered as the card's Settings form. */
  configFields: Omit<ConfigField, 'normalise'>[];
  /** Required settings with no value yet. A sync cannot succeed while this is non-empty. */
  missingConfig: string[];
  lastSyncAt: Date | null;
  lastSyncRows: number | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  connectedByEmail: string | null;
  /** When the stored credential lapses, so the card can warn before it does. */
  credentialExpiresAt: Date | null;
  /**
   * Whole days until the stored authorisation expires, negative once it has.
   *
   * Derived here rather than in the card that renders it: `Date.now()` in a render is
   * impure, and a credential sitting on a day boundary could hydrate with a different
   * number than it was served with. Null when there is nothing to count down to.
   */
  credentialExpiresInDays: number | null;
  config: Record<string, unknown> | null;
};

/**
 * One card per registered provider, whether or not it has ever been connected.
 *
 * `state` comes from the Integration row. Where a row claims `connected` but no
 * credential exists, the card reports `error` rather than the claim — a connected badge
 * with nothing behind it is the exact lie this module exists to prevent.
 */
async function readCards(): Promise<Card[]> {
  const rows = await db().integration.findMany({
    select: {
      provider: true,
      state: true,
      lastSyncAt: true,
      lastSyncRows: true,
      lastError: true,
      lastErrorAt: true,
      connectedByEmail: true,
      config: true,
      // For the stalled-sync test below. `state` alone cannot tell a run in progress from
      // one that died holding the lock.
      updatedAt: true,
      credential: { select: { id: true, expiresAt: true } },
    },
  });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return providerList().map((p) => {
    const row = byProvider.get(p.id);
    const hasCredential = !!row?.credential;
    const config = (row?.config as Record<string, unknown> | null) ?? {};
    const missingEnv = p.requiredEnv.filter((e) => !process.env[e.name]);

    // Widened deliberately: Card.state is a string because not every state the badge can
    // show is one the database stores. 'sync_stalled' below is derived, never persisted.
    let state: string = row?.state ?? 'disconnected';
    if (state === 'connected' && !hasCredential) state = 'error';
    // A run that died without clearing `state` leaves the card saying "Syncing…" forever.
    // claimSync already treats a lease this old as abandoned and lets the next run take
    // it, so the row is not actually busy — only the badge claimed it was. Zoho CRM sat on
    // "Syncing…" for 17 hours next to "0 rows" and nothing on the page explained it.
    if (
      state === 'syncing' &&
      row &&
      Date.now() - row.updatedAt.getTime() > SYNC_LEASE_MS
    ) {
      state = 'sync_stalled';
    }

    return {
      id: p.id,
      name: p.name,
      category: p.category,
      authKind: p.authKind,
      summary: p.summary,
      provides: p.provides,
      docsUrl: p.docsUrl,
      state,
      hasCredential,
      configured: p.isConfigured() && hasEncryptionKey(),
      missingEnv,
      // normalise is a function; it cannot cross the server/client boundary.
      configFields: (p.configFields ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        placeholder: f.placeholder,
        help: f.help,
        required: f.required,
      })),
      missingConfig: (p.configFields ?? [])
        .filter((f) => f.required && !String(config[f.name] ?? '').trim())
        .map((f) => f.label),
      lastSyncAt: row?.lastSyncAt ?? null,
      lastSyncRows: row?.lastSyncRows ?? null,
      lastError:
        state === 'error' && !hasCredential && row?.state === 'connected'
          ? 'Marked connected but no credential is stored. Reconnect.'
          : (row?.lastError ?? null),
      lastErrorAt: row?.lastErrorAt ?? null,
      connectedByEmail: row?.connectedByEmail ?? null,
      credentialExpiresAt: row?.credential?.expiresAt ?? null,
      credentialExpiresInDays: row?.credential?.expiresAt
        ? Math.ceil((row.credential.expiresAt.getTime() - Date.now()) / 86_400_000)
        : null,
      config,
    };
  });
}

function requireProvider(id: string) {
  const provider = getProvider(id);
  if (!provider) throw new IntegrationError(`Unknown integration: ${id}`);
  return provider;
}

export function authUrlFor(id: string, redirectUri: string, state: string): string {
  const provider = requireProvider(id);
  if (!provider.isConfigured()) {
    const missing = provider.requiredEnv.filter((e) => !process.env[e.name]).map((e) => e.name);
    throw new IntegrationError(`${provider.name} needs ${missing.join(' and ')} before it can connect.`);
  }
  const url = provider.getAuthUrl(redirectUri, state);
  if (!url) throw new IntegrationError(`${provider.name} connects with an API key, not OAuth.`);
  return url;
}

export async function connect(id: string, input: ConnectInput, actorEmail: string) {
  const provider = requireProvider(id);
  if (!hasEncryptionKey()) {
    throw new IntegrationError('APP_ENCRYPTION_KEY is not set, so credentials cannot be stored safely.');
  }

  await db().integration.upsert({
    where: { provider: id },
    create: { provider: id, state: 'connecting' },
    update: { state: 'connecting', lastError: null, lastErrorAt: null },
  });

  try {
    const result = await provider.connect(input);
    const sealed = seal(result.secret);

    const integration = await db().integration.update({
      where: { provider: id },
      data: {
        state: 'connected',
        connectedByEmail: actorEmail,
        connectedAt: new Date(),
        config: (result.config ?? undefined) as Prisma.InputJsonValue | undefined,
        lastError: null,
        lastErrorAt: null,
      },
      select: { id: true },
    });

    await db().integrationCredential.upsert({
      where: { integrationId: integration.id },
      create: { integrationId: integration.id, ...sealed, expiresAt: result.expiresAt },
      update: { ...sealed, expiresAt: result.expiresAt },
    });

    await db().auditEvent.create({
      data: { actorEmail, action: 'integration.connect', entityType: 'integration', entityId: id },
    });

    return { ok: true as const };
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : 'Connection failed.';
    await db().integration.update({
      where: { provider: id },
      data: { state: 'error', lastError: message, lastErrorAt: new Date() },
    });
    throw new IntegrationError(message);
  }
}

export async function disconnect(id: string, actorEmail: string) {
  requireProvider(id);

  const integration = await db().integration.findUnique({
    where: { provider: id },
    select: { id: true },
  });
  if (!integration) return { ok: true as const };

  // The credential goes first: if this fails halfway, an integration with no
  // credential reads as disconnected, which is true. The reverse would leave a stored
  // secret behind a card that says disconnected.
  await db().integrationCredential.deleteMany({ where: { integrationId: integration.id } });
  await db().integration.update({
    where: { id: integration.id },
    data: {
      state: 'disconnected',
      lastSyncAt: null,
      lastSyncRows: null,
      lastError: null,
      lastErrorAt: null,
      connectedByEmail: null,
      connectedAt: null,
      // `config` is deliberately left standing, and `undefined` is how Prisma is told to
      // leave a column alone. It holds no secret — the GA4 property ID, the Meta ad
      // account, the Search Console site URL, all typed by hand on the card's Settings
      // form — so keeping it costs nothing and saves re-typing them on the next connect.
      // The secret is the credential row, and that is deleted above.
      config: undefined,
      // The sync watermark is the opposite case: reconnecting means starting clean. Without this the watermark survives, so the
      // next sync would ask only for records modified since the old connection and quietly
      // skip everything already imported — which is also the only way to re-pull records
      // whose stored copy is wrong.
      syncCursor: Prisma.DbNull,
      syncedThrough: null,
    },
  });
  await db().auditEvent.create({
    data: { actorEmail, action: 'integration.disconnect', entityType: 'integration', entityId: id },
  });

  return { ok: true as const };
}

/** Writes a provider's points into MetricSnapshot. Upserts on the natural key so a
 *  re-sync of the same day corrects the value instead of duplicating it.
 *
 *  Written as a multi-row INSERT ... ON CONFLICT rather than a loop of Prisma upserts.
 *  The loop was one network round trip per row: a month of Meta campaign data is around
 *  700 rows, which took over a hundred seconds against Neon and blew the serverless
 *  function limit long before it finished. One statement per chunk instead. */
const WRITE_CHUNK = 500;

/** Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row twice within
 *  one statement ("cannot affect row a second time"), so a batch carrying two points with
 *  the same natural key aborts the whole chunk. Providers legitimately emit those: an
 *  account whose campaigns report the same metric on the same day, or a paged pull whose
 *  last page overlaps the next one's first. Collapse them here, last value winning, which
 *  is the same outcome the upsert would have produced row by row. */
function dedupePoints(points: MetricPoint[]): MetricPoint[] {
  const byKey = new Map<string, MetricPoint>();
  for (const p of points) {
    const day = p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date);
    byKey.set(JSON.stringify([p.entityType, p.entityId ?? '', p.metricKey, day]), p);
  }
  return [...byKey.values()];
}

async function writePoints(source: string, rawPoints: MetricPoint[]): Promise<number> {
  // `record` points are not archived, because there is nothing in them to archive.
  //
  // A metric_snapshot row holds source, entityType, entityId, metricKey, date and value
  // — there is no payload column — so a `record` point stores only "this entity existed",
  // which the typed tables already say better: lead, contact, opportunity and prospect
  // each carry `source` and `externalId`. Nothing reads them back either; the
  // materialisers below filter the same in-memory `points` array this function receives,
  // never the database.
  //
  // They were 258,802 of the table's 277,886 rows and about 35 MB of a 118 MB table —
  // 93% of it — growing with every record the CRM holds rather than with time, which is
  // why a retention window would have freed almost nothing. The 19,084 genuine
  // time-series rows are what the charts read, and they are all kept.
  const points = dedupePoints(rawPoints).filter((p) => p.metricKey !== 'record');
  if (!points.length) return 0;

  let written = 0;

  for (let i = 0; i < points.length; i += WRITE_CHUNK) {
    const chunk = points.slice(i, i + WRITE_CHUNK);

    // @default(cuid()) is applied by Prisma, not by Postgres, so a raw insert has to
    // supply the id itself. gen_random_uuid() is built in from PG13 — a uuid rather than
    // a cuid, which only these provider-written rows will carry.
    const values = chunk.map((p) => [
      source,
      p.entityType,
      p.entityId ?? '',
      p.metricKey,
      p.date,
      p.value,
    ]);

    const placeholders = values
      .map(
        (_, r) =>
          `(gen_random_uuid()::text, $${r * 6 + 1}, $${r * 6 + 2}, $${r * 6 + 3}, $${r * 6 + 4}, $${r * 6 + 5}::date, $${r * 6 + 6}::numeric)`,
      )
      .join(', ');

    written += await db().$executeRawUnsafe(
      `INSERT INTO metric_snapshot (id, source, "entityType", "entityId", "metricKey", date, value)
       VALUES ${placeholders}
       ON CONFLICT (source, "entityType", "entityId", "metricKey", date)
       DO UPDATE SET value = EXCLUDED.value`,
      ...values.flat(),
    );
  }

  return written;
}


/**
 * Turns `ad_campaign` metric points into real Campaign and MarketingSpend rows.
 *
 * metric_snapshot is the honest archive of what a provider reported, but nothing on the
 * Marketing page reads it: campaign tables, ROAS and CAC all read MarketingSpend joined
 * to Campaign. Without this step a provider can sync perfectly and every chart still
 * shows nothing — which is exactly what Meta did.
 *
 * Campaigns are matched on (source, externalId), so a re-sync updates in place and a
 * renamed campaign follows rather than duplicating.
 */
async function writeCampaignSpend(
  provider: ReturnType<typeof requireProvider>,
  points: MetricPoint[],
): Promise<number> {
  const channel = provider.channel;
  if (!channel) return 0;

  const relevant = points.filter((p) => p.entityType === 'ad_campaign' && p.entityId);
  if (!relevant.length) return 0;

  const channelRow = await db().channel.upsert({
    where: { slug: channel.slug },
    create: { slug: channel.slug, name: channel.name, kind: channel.kind },
    update: {},
    select: { id: true },
  });

  // Last label wins; they are identical across a campaign's rows.
  const names = new Map<string, string>();
  for (const p of relevant) {
    if (p.entityLabel) names.set(p.entityId as string, p.entityLabel);
  }

  // The campaign's own schedule and budget, carried on the points rather than fetched
  // again here. Every campaign read as an undated, unbudgeted "active" until the provider
  // started sending them.
  const details = new Map<string, Record<string, unknown>>();
  for (const p of relevant) {
    const m = meta(p);
    if (m.status || m.startDate || m.endDate || m.budget != null) {
      details.set(p.entityId as string, m);
    }
  }

  const campaignIdByExternal = new Map<string, string>();
  for (const [externalId, name] of names) {
    const d = details.get(externalId);
    const date = (v: unknown) => {
      const parsed = v ? new Date(String(v)) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    };
    // Only what the provider actually reported. Spreading undefined into a Prisma update
    // is a no-op, so a campaign whose details failed to load keeps whatever it had.
    const extra = d
      ? {
          status: str(d.status) ?? undefined,
          // The budget is quoted in the ad account's currency, which is not necessarily
          // the workspace's; pacing divides it by spend and both must agree.
          currency: str(d.currency) ?? undefined,
          startDate: date(d.startDate) ?? undefined,
          endDate: date(d.endDate) ?? undefined,
          budget: typeof d.budget === 'number' ? d.budget : undefined,
          // Stored beside the amount because the amount alone is not comparable to a
          // period's spend — see Campaign.budgetPeriod.
          budgetPeriod: str(d.budgetPeriod) ?? undefined,
        }
      : {};

    const row = await db().campaign.upsert({
      where: { source_externalId: { source: provider.id, externalId } },
      create: { name, channelId: channelRow.id, source: provider.id, externalId, ...extra },
      update: { name, ...extra },
      select: { id: true },
    });
    campaignIdByExternal.set(externalId, row.id);
  }

  // One row per campaign-day, carrying whichever of the three metrics arrived.
  type Day = { campaignId: string; date: Date; amount: number; impressions: number; clicks: number; currency: string };
  const days = new Map<string, Day>();

  for (const p of relevant) {
    const campaignId = campaignIdByExternal.get(p.entityId as string);
    if (!campaignId) continue;

    const iso = p.date.toISOString().slice(0, 10);
    const key = `${campaignId}|${iso}`;
    let day = days.get(key);
    if (!day) {
      day = { campaignId, date: p.date, amount: 0, impressions: 0, clicks: 0, currency: 'USD' };
      days.set(key, day);
    }

    // The platform's billing currency, not the workspace's. A provider that does not
    // report one leaves the column at its USD default rather than inventing an answer.
    const reported = str(meta(p).currency);
    if (reported) day.currency = reported.toUpperCase();

    if (p.metricKey === 'spend') day.amount = p.value;
    else if (p.metricKey === 'impressions') day.impressions = Math.round(p.value);
    else if (p.metricKey === 'clicks') day.clicks = Math.round(p.value);
  }

  const rows = [...days.values()];
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const values = chunk.map((d) => [d.campaignId, d.date, d.amount, d.impressions, d.clicks, d.currency]);
    const placeholders = values
      .map(
        (_, r) =>
          `(gen_random_uuid()::text, $${r * 6 + 1}, $${r * 6 + 2}::date, $${r * 6 + 3}::numeric, $${r * 6 + 4}::int, $${r * 6 + 5}::int, $${r * 6 + 6})`,
      )
      .join(', ');

    await db().$executeRawUnsafe(
      `INSERT INTO marketing_spend (id, "campaignId", date, amount, impressions, clicks, currency)
       VALUES ${placeholders}
       ON CONFLICT ("campaignId", date)
       DO UPDATE SET amount = EXCLUDED.amount,
                     impressions = EXCLUDED.impressions,
                     clicks = EXCLUDED.clicks,
                     currency = EXCLUDED.currency`,
      ...values.flat(),
    );
  }

  return rows.length;
}

/**
 * Turns `social_account` and `social_post` points into SocialAccount and SocialPost rows.
 *
 * Same reason writeCampaignSpend exists: the Social page reads those tables and never
 * touches metric_snapshot, so without this a social provider could sync perfectly and the
 * page would still show only what the seeder left behind.
 *
 * The account's `integrationId` is stamped here, which is what lets the page drop its
 * "seeded" badge for this network while keeping it on the others.
 */
async function writeSocialActivity(
  integrationId: string,
  points: MetricPoint[],
): Promise<number> {
  const accountPoints = points.filter((p) => p.entityType === 'social_account' && p.entityId);
  const postPoints = points.filter((p) => p.entityType === 'social_post' && p.entityId);
  if (!accountPoints.length && !postPoints.length) return 0;

  // Anything outside the SocialNetwork enum is dropped rather than guessed at: a bad
  // value would fail the insert and take the whole sync down with it.
  const NETWORKS = new Set(['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok']);
  const networkOf = (p: MetricPoint) => {
    const n = (p.entityMeta?.network as string | undefined)?.toLowerCase();
    return n && NETWORKS.has(n) ? n : null;
  };

  // (network, handle) is SocialAccount's natural key, so accounts are keyed the same way
  // here and a re-sync updates in place rather than duplicating.
  const accountIdByKey = new Map<string, string>();

  for (const p of accountPoints) {
    const network = networkOf(p);
    const handle = p.entityMeta?.handle as string | undefined;
    if (!network || !handle) continue;

    const name = (p.entityMeta?.name as string | undefined) ?? null;
    const row = await db().socialAccount.upsert({
      where: { network_handle: { network: network as never, handle } },
      create: {
        network: network as never,
        handle,
        name,
        followers: Math.round(p.value),
        integrationId,
      },
      update: { name: name ?? undefined, followers: Math.round(p.value), integrationId },
      select: { id: true },
    });
    accountIdByKey.set(`${network}:${handle}`, row.id);
  }

  // Accounts this integration used to report and no longer does.
  //
  // The upsert above adds and updates but never removes, so a connection that changes
  // which accounts it covers left the old ones behind wearing this integrationId — and
  // the Social page cannot tell a stale row from a live one, so it renders them side by
  // side as though both were current. That is how a Facebook Page granted by mistake
  // stayed on the page after the reconnect that replaced it.
  //
  // Guarded on what was actually RESOLVED, not on what arrived.
  //
  // The guard used to be `accountPoints.length`, and the keep-set is built by the loop
  // above, which skips any point whose entityMeta carries no network or no handle. A sync
  // that reported accounts but resolved none of them therefore reached this delete with an
  // empty keep-set — and Prisma compiles `notIn: []` to a condition that matches every
  // row, so it wiped every account this integration had. That is how the Social page came
  // to read "No social accounts. Connect Facebook and Instagram" while the integration
  // was still syncing a follower count for facebook:gyanodayanandanvan every day.
  //
  // A sync that resolved no accounts says nothing about which accounts exist, exactly as
  // a sync that reported none says nothing. Posts go with the account by cascade.
  const keep = [...accountIdByKey.values()];
  if (keep.length) {
    const pruned = await db().socialAccount.deleteMany({
      where: { integrationId, id: { notIn: keep } },
    });
    if (pruned.count) {
      console.info(
        `[social] pruned ${pruned.count} account(s) this integration no longer reports`,
      );
    }
  } else if (accountPoints.length) {
    // Said out loud: the accounts are being reported and none of them can be written, so
    // the Social page will stay empty and nothing else would explain why.
    console.warn(
      `[social] ${accountPoints.length} account point(s) carried no usable network/handle; nothing written and nothing pruned`,
    );
  }

  // One row per post, carrying whichever metrics that network reported. A key the
  // provider omitted keeps the column default rather than being written as zero —
  // Instagram reports no link clicks on organic media, and a 0 there would read as
  // "nobody clicked" rather than "not measured".
  type Post = {
    accountKey: string;
    externalId: string;
    publishedAt: Date;
    permalink: string | null;
    caption: string | null;
    metrics: Record<string, number>;
  };
  const posts = new Map<string, Post>();

  // The metrics are spread straight into the insert, so a key with no column behind it
  // would fail the write and take the whole sync down with it. Providers are free to
  // report more than the schema holds; anything unrecognised is dropped here instead.
  const METRIC_COLUMNS = new Set([
    'reach',
    'impressions',
    'likes',
    'comments',
    'shares',
    'saves',
    'clicks',
  ]);

  for (const p of postPoints) {
    const network = networkOf(p);
    const handle = p.entityMeta?.handle as string | undefined;
    if (!network || !handle) continue;

    const externalId = p.entityId as string;
    let post = posts.get(externalId);
    if (!post) {
      const published = new Date(String(p.entityMeta?.publishedAt ?? p.date.toISOString()));
      post = {
        accountKey: `${network}:${handle}`,
        externalId,
        publishedAt: Number.isNaN(published.getTime()) ? p.date : published,
        permalink: (p.entityMeta?.permalink as string | null | undefined) ?? null,
        caption: (p.entityMeta?.caption as string | null | undefined) ?? null,
        metrics: {},
      };
      posts.set(externalId, post);
    }
    if (METRIC_COLUMNS.has(p.metricKey)) post.metrics[p.metricKey] = Math.round(p.value);
  }

  let postsWritten = 0;
  for (const post of posts.values()) {
    const accountId = accountIdByKey.get(post.accountKey);
    // A post whose account never reported a follower count has nothing to hang off.
    if (!accountId) continue;

    const fields = {
      publishedAt: post.publishedAt,
      permalink: post.permalink,
      caption: post.caption,
      ...post.metrics,
    };

    await db().socialPost.upsert({
      where: { accountId_externalId: { accountId, externalId: post.externalId } },
      create: { accountId, externalId: post.externalId, ...fields },
      update: fields,
    });
    postsWritten++;
  }

  return accountIdByKey.size + postsWritten;
}

/**
 * Turns `seo_keyword` and `seo_page` points into the SEO tables.
 *
 * Until this existed nothing but the seeder wrote SeoKeyword, SeoKeywordRanking or
 * SeoPage, so the SEO page stayed fully seeded no matter what was connected. Rows written
 * here carry `source`, so the page can tell a reported ranking from an invented one
 * sitting in the same table.
 */
async function writeSeoRows(
  provider: ReturnType<typeof requireProvider>,
  config: Record<string, unknown>,
  points: MetricPoint[],
): Promise<number> {
  const keywordPoints = points.filter((p) => p.entityType === 'seo_keyword' && p.entityId);
  const pagePoints = points.filter((p) => p.entityType === 'seo_page' && p.entityId);
  if (!keywordPoints.length && !pagePoints.length) return 0;

  // Every SEO row hangs off a Website. Prefer the domain the provider was configured
  // with; fall back to whatever site already exists, so a provider without such a setting
  // lands on the existing site rather than creating a second one.
  const configured = typeof config.siteUrl === 'string' ? config.siteUrl : '';
  const domain = configured
    .replace(/^sc-domain:/, '')
    .replace(/^https?:[/][/]/, '')
    .replace(/[/].*$/, '')
    .trim();

  const website = domain
    ? await db().website.upsert({
        where: { domain },
        create: { domain, name: domain },
        update: {},
        select: { id: true },
      })
    : await db().website.findFirst({ select: { id: true } });
  if (!website) return 0;

  let written = 0;

  // ── keywords: one row per phrase, one ranking row per phrase-day ─────────────────
  type Ranking = { date: Date; position: number; url: string | null };
  const byKeyword = new Map<string, Ranking[]>();

  for (const p of keywordPoints) {
    if (p.metricKey !== 'position') continue;
    const keyword = p.entityId as string;
    const rankings = byKeyword.get(keyword) ?? [];
    // Which page holds the position. The column existed and stayed null on all 5,000
    // rows, so the table could say a term ranked third without saying third with what.
    rankings.push({ date: p.date, position: Math.round(p.value), url: str(meta(p).url) });
    byKeyword.set(keyword, rankings);
  }

  // Three statements rather than one per row. A loop of upserts here was 1,760 keyword
  // round trips plus 5,000 ranking ones against Neon — the same shape of mistake
  // writePoints was written to avoid, and it grows with the site.
  //
  // searchVolume, difficulty and cpc are deliberately left unset. Search Console does not
  // report them, and a number invented to fill the column is exactly the kind of figure
  // this app labels rather than fabricates.
  const keywords = [...byKeyword.keys()];
  if (keywords.length) {
    await bulkUpsert(
      'seo_keyword',
      ['websiteId', 'keyword', 'country', 'source'],
      keywords.map((keyword) => [website.id, keyword, 'us', provider.id]),
      '"websiteId", "keyword", "country"',
      {},
      false,
    );

    // Read back rather than returned by the upsert: seo_keyword has no externalId, which
    // is the only column bulkUpsert can hand back to identify a row.
    const idByKeyword = new Map<string, string>();
    const LOOKUP_CHUNK = 1000;
    for (let i = 0; i < keywords.length; i += LOOKUP_CHUNK) {
      const rows = await db().seoKeyword.findMany({
        where: { websiteId: website.id, country: 'us', keyword: { in: keywords.slice(i, i + LOOKUP_CHUNK) } },
        select: { id: true, keyword: true },
      });
      for (const r of rows) idByKeyword.set(r.keyword, r.id);
    }

    const rankingRows: unknown[][] = [];
    for (const [keyword, rankings] of byKeyword) {
      const keywordId = idByKeyword.get(keyword);
      if (!keywordId) continue;
      for (const ranking of rankings) {
        rankingRows.push([keywordId, ranking.date, ranking.position, ranking.url]);
      }
    }

    const touched = await bulkUpsert(
      'seo_keyword_ranking',
      ['keywordId', 'date', 'position', 'url'],
      rankingRows,
      '"keywordId", "date"',
      { date: 'date', position: 'int' },
      false,
    );
    written += touched.length;
  }

  // ── pages: one current row per URL ───────────────────────────────────────────────
  const byPage = new Map<string, Record<string, number>>();
  for (const p of pagePoints) {
    const url = p.entityId as string;
    const entry = byPage.get(url) ?? {};
    entry[p.metricKey] = p.value;
    byPage.set(url, entry);
  }

  const pageRows = [...byPage].map(([url, m]) => [
    website.id,
    url,
    Math.round(m.clicks ?? 0),
    Math.round(m.impressions ?? 0),
    m.ctr ?? 0,
    m.position ?? 0,
    provider.id,
  ]);
  if (pageRows.length) {
    const touched = await bulkUpsert(
      'seo_page',
      ['websiteId', 'url', 'clicks', 'impressions', 'ctr', 'avgPosition', 'source'],
      pageRows,
      '"websiteId", "url"',
      // Float columns, not Decimal — casting to numeric would rely on an implicit
      // conversion on the way in.
      { clicks: 'int', impressions: 'int', ctr: 'double precision', avgPosition: 'double precision' },
    );
    written += touched.length;
  }

  return written;
}

const STAGE_SELECT = {
  id: true,
  name: true,
  position: true,
  probability: true,
  isWon: true,
  isLost: true,
} as const;

/**
 * One chunked `INSERT … ON CONFLICT DO UPDATE`, returning the id of every row it touched.
 *
 * The CRM import writes tens of thousands of records — this org has 26,000 leads alone —
 * and a per-record Prisma upsert is one network round trip each. At that size the sync
 * cannot finish inside the cron's 300s budget, so the rows go out in batches the way
 * writePoints and writeCampaignSpend already do.
 *
 * `casts` carries the Postgres type for any column a text placeholder cannot satisfy on
 * its own — the enum columns and the numerics.
 */

/** A point's provider payload, and a trimmed string from it — every materialiser reads
 *  entityMeta the same defensive way, so they read it through these. */
const meta = (p: MetricPoint) => (p.entityMeta ?? {}) as Record<string, unknown>;
const str = (v: unknown): string | null => {
  const t = v == null ? '' : String(v).trim();
  return t === '' ? null : t;
};

/**
 * When the CRM says the record was created, for the row's own createdAt.
 *
 * Left to default(now()) every imported record is stamped with the moment of the import
 * instead — 26,043 of 26,138 leads landed on one day, so every trend chart showed a
 * single spike on import day and every period-over-period delta compared a full CRM
 * against nothing. The provider already dates each point from the CRM's Created_Time;
 * this is only carrying it through to the table the pages read.
 */
/**
 * An imported address, lower-cased.
 *
 * The CRM stores whatever was typed — 1,411 leads here begin with a capital — and the
 * duplicate check matches on exact equality against an index, so a returning enquirer
 * whose stored address reads `Sam@gmail.com` was never matched to `sam@gmail.com` and
 * arrived as a second lead.
 *
 * Case only. `normalizeEmail` also strips gmail dots and +tags, which is right for
 * comparison and wrong for storage: the address on the record has to stay the one you
 * could actually write to.
 */
const importedEmail = (value: unknown): string | null => {
  const email = str(value);
  return email ? email.toLowerCase() : null;
};

const createdAtOf = (p: MetricPoint): Date => {
  // The provider's own timestamp when it sent one. A point's `date` is a day — metric
  // rows are keyed on it — so using it here put every record on exactly midnight, losing
  // the order of arrivals within a day and any measure that subtracts from them.
  const exact = str(meta(p).createdAt);
  if (exact) {
    const d = new Date(exact);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return p.date;
};

async function bulkUpsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
  casts: Record<string, string> = {},
  /** False for the few tables Prisma gave no updatedAt column — sequence_step. */
  stamped = true,
): Promise<{ id: string; externalId: string | null }[]> {
  if (!rows.length) return [];

  // Same rule that forced dedupePoints: one statement may not update a row twice, so two
  // rows sharing the conflict key abort the chunk. The key columns are named in
  // `conflict`, so they can be read off it rather than passed again.
  const keyColumns = conflict.split(',').map((c) => c.trim().replace(/"/g, ''));
  const keyIndexes = keyColumns.map((c) => columns.indexOf(c)).filter((i) => i >= 0);
  if (keyIndexes.length === keyColumns.length) {
    const byKey = new Map<string, unknown[]>();
    for (const r of rows) byKey.set(JSON.stringify(keyIndexes.map((i) => r[i])), r);
    rows = [...byKey.values()];
  }

  const cols = stamped ? [...columns, 'updatedAt'] : [...columns];
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const assignments = cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  // Only tables that carry provenance can return it; sequence_step is keyed on its
  // parent and position instead.
  const returning = columns.includes('externalId') ? 'id, "externalId"' : 'id, NULL AS "externalId"';
  const touched: { id: string; externalId: string | null }[] = [];

  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const values = stamped ? chunk.map((r) => [...r, new Date()]) : chunk.map((r) => [...r]);
    const width = cols.length;

    const placeholders = values
      .map((_, r) => {
        const cells = cols.map((c, k) => {
          const n = r * width + k + 1;
          return casts[c] ? `$${n}::${casts[c]}` : `$${n}`;
        });
        return `(gen_random_uuid()::text, ${cells.join(', ')})`;
      })
      .join(', ');

    const returned = await db().$queryRawUnsafe<{ id: string; externalId: string | null }[]>(
      `INSERT INTO "${table}" (id, ${quoted})
       VALUES ${placeholders}
       ON CONFLICT (${conflict}) DO UPDATE SET ${assignments}
       RETURNING ${returning}`,
      ...values.flat(),
    );
    touched.push(...returned);
  }

  return touched;
}

/**
 * Puts a person's name into the two columns the schema has.
 *
 * Lead.firstName and Contact.firstName are NOT NULL, so something must fill them. The
 * obvious fallback — first name, else the display label — is wrong: Zoho makes Last_Name
 * mandatory and First_Name optional, so most records here carry the whole name in
 * Last_Name alone. Falling back to the label then copied that same name into firstName,
 * and 21,151 of 26,073 leads rendered as "Irshad Alli Irshad Alli".
 *
 * A lone name belongs in firstName with lastName empty, so joining the two reads correctly
 * whichever way round the source happened to store it.
 */
export function splitName(
  first: string | null,
  last: string | null,
  label: string | undefined,
  fallback: string,
): { firstName: string; lastName: string | null } {
  // Cleaned here rather than at the two call sites, so leads and contacts are both
  // covered and a third importer cannot forget.
  const f = cleanImportedName(first);
  const l = cleanImportedName(last);
  const lbl = cleanImportedName(label);
  if (f && l) return { firstName: f, lastName: l };
  return { firstName: f ?? l ?? lbl ?? fallback, lastName: null };
}

/**
 * Turns `crm_lead`, `crm_contact` and `crm_deal` points into real Lead, Contact and
 * Opportunity rows, plus the Company rows they hang off.
 *
 * Same reason writeCampaignSpend and writeSocialActivity exist. Zoho CRM shipped
 * reporting three `record_count` numbers into metric_snapshot and nothing else — and
 * nothing in the app reads metric_snapshot for CRM. The Leads, Contacts and Pipeline
 * pages all read these tables, so a Zoho sync could succeed completely and every one of
 * those pages would still show only what the seeder left behind.
 *
 * Records are matched on (source, externalId), so a re-sync updates in place. Within the
 * fields the provider reports, the provider wins: an edit made in Growth Center to a
 * Zoho-owned lead is overwritten on the next sync. That is the right default for a mirror
 * of an upstream CRM, and the things Growth Center owns alone — tags, notes, tasks,
 * activities, owner assignment — are never touched here.
 */
async function writeCrmRecords(providerId: string, points: MetricPoint[]): Promise<number> {
  const accountPoints = points.filter((p) => p.entityType === 'crm_account' && p.entityId);
  const leadPoints = points.filter((p) => p.entityType === 'crm_lead' && p.entityId);
  const contactPoints = points.filter((p) => p.entityType === 'crm_contact' && p.entityId);
  const dealPoints = points.filter((p) => p.entityType === 'crm_deal' && p.entityId);
  if (!accountPoints.length && !leadPoints.length && !contactPoints.length && !dealPoints.length) {
    return 0;
  }

  let written = 0;

  // ── companies ───────────────────────────────────────────────────────────────
  // Two ways a company arrives, and the richer one goes first.
  //
  // The account module carries the details — website, phone, industry, country. Contacts
  // and deals only mention an account by id and name, which is all a company row used to
  // get: 2,761 of them with a name and nine empty columns.
  //
  // The name-only pass still runs, for an account referenced by a deal in this batch whose
  // own record has not been fetched yet. It sets `name` alone, so it cannot blank the
  // details a fuller row already has.
  //
  // `domain` is left alone deliberately. It is unique, and two companies sharing a website
  // — a group and its subsidiary, or two records for one client — would abort the whole
  // batch on that index rather than write anything.
  const companyIdByExternal = new Map<string, string>();

  if (accountPoints.length) {
    const rows = accountPoints.map((p) => {
      const m = meta(p);
      const externalId = p.entityId as string;
      const name = str(m.name) ?? p.entityLabel ?? externalId;
      return [
        name,
        normalizeCompanyName(name),
        str(m.website),
        str(m.phone),
        str(m.industry),
        str(m.country),
        str(m.size),
        str(m.notes),
        str(m.ownerEmail),
        createdAtOf(p),
        providerId,
        externalId,
      ];
    });
    const detailed = await bulkUpsert(
      'company',
      ['name', 'nameKey', 'website', 'phone', 'industry', 'country', 'size', 'notes', 'ownerEmail', 'createdAt', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { createdAt: 'timestamp(3)' },
    );
    for (const r of detailed) if (r.externalId) companyIdByExternal.set(r.externalId, r.id);
    written += detailed.length;
  }

  const accounts = new Map<string, string>();
  for (const p of [...contactPoints, ...dealPoints]) {
    const id = str(meta(p).accountId);
    const name = str(meta(p).accountName);
    if (id && name && !companyIdByExternal.has(id)) accounts.set(id, name);
  }

  if (accounts.size) {
    const companyRows = [...accounts].map(([externalId, name]) => [
      name,
      normalizeCompanyName(name),
      providerId,
      externalId,
    ]);
    const companies = await bulkUpsert(
      'company',
      ['name', 'nameKey', 'source', 'externalId'],
      companyRows,
      '"source", "externalId"',
    );
    for (const r of companies) if (r.externalId) companyIdByExternal.set(r.externalId, r.id);
    written += companies.length;
  }

  // ── contacts ────────────────────────────────────────────────────────────────
  const contactIdByExternal = new Map<string, string>();
  if (contactPoints.length) {
    // Contact.email is globally unique, which a bulk insert cannot negotiate: a row whose
    // address already exists would abort the whole batch on the wrong index. So the
    // colliding addresses are resolved up front — rows already here are adopted (stamped
    // with this provider's id) one by one, and everything else goes out in batches.
    // Lower-cased, matching what is written: the stored address is now case-normalised,
    // so looking a clash up in the CRM's own casing would miss it — and the row would go
    // out in a batch that then aborts on the unique index, taking the whole chunk with it.
    const emails = [
      ...new Set(contactPoints.map((p) => importedEmail(meta(p).email)).filter((e): e is string => !!e)),
    ];
    const existing = emails.length
      ? await db().contact.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true, source: true, externalId: true },
        })
      : [];
    const byEmail = new Map(existing.map((c) => [c.email ?? '', c]));

    // Zoho permits two contacts to share an address; this schema does not. First occurrence
    // keeps the address, later ones are imported without it rather than being dropped.
    const claimedInBatch = new Set<string>();
    let deduped = 0;

    const adopt: { id: string; row: Record<string, unknown>; externalId: string; createdAt: Date }[] = [];
    const fresh: unknown[][] = [];

    for (const p of contactPoints) {
      const m = meta(p);
      const externalId = p.entityId as string;
      let email = importedEmail(m.email);

      if (email && claimedInBatch.has(email)) {
        email = null;
        deduped++;
      } else if (email) {
        claimedInBatch.add(email);
      }

      const accountId = str(m.accountId);
      const name = splitName(str(m.firstName), str(m.lastName), p.entityLabel, externalId);
      const row = {
        firstName: name.firstName,
        lastName: name.lastName,
        email,
        phone: str(m.phone),
        title: str(m.title),
        companyId: accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
        ownerEmail: str(m.ownerEmail),
      };

      const clash = email ? byEmail.get(email) : undefined;
      const alreadyOurs = clash?.source === providerId && clash?.externalId === externalId;

      if (clash && !alreadyOurs) {
        adopt.push({ id: clash.id, row, externalId, createdAt: createdAtOf(p) });
      } else {
        fresh.push([row.firstName, row.lastName, row.email, row.phone, row.title, row.companyId, row.ownerEmail, createdAtOf(p), providerId, externalId]);
      }
    }

    for (const a of adopt) {
      await db().contact.update({
        where: { id: a.id },
        data: { ...a.row, createdAt: a.createdAt, source: providerId, externalId: a.externalId },
      });
      contactIdByExternal.set(a.externalId, a.id);
      written++;
    }

    const touched = await bulkUpsert(
      'contact',
      ['firstName', 'lastName', 'email', 'phone', 'title', 'companyId', 'ownerEmail', 'createdAt', 'source', 'externalId'],
      fresh,
      '"source", "externalId"',
      { createdAt: 'timestamp(3)' },
    );
    for (const t of touched) if (t.externalId) contactIdByExternal.set(t.externalId, t.id);
    written += touched.length;

    if (deduped) {
      console.warn(`[${providerId}] ${deduped} contacts imported without an email: address already used by another contact.`);
    }
  }

  // ── leads ───────────────────────────────────────────────────────────────────
  // Channels are looked up once. Without a channel on the lead, every figure on the
  // Marketing page groups by a column that is null on all 27,181 rows.
  const channelIdBySlug = new Map(
    (await db().channel.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  const leadRows = leadPoints.map((p) => {
    const m = meta(p);
    const externalId = p.entityId as string;
    const name = splitName(str(m.firstName), str(m.lastName), p.entityLabel, externalId);
    const status = leadStatus(str(m.status));
    const sourceDetail = str(m.leadSource);
    const sourceType = leadSourceType(sourceDetail);
    const channelSlug = channelSlugFor(sourceType, sourceDetail);

    // The funnel counts qualified leads by qualifiedAt, not by current status, so that
    // converting a lead cannot make the qualified count go down. An import that set the
    // status and left the timestamp null therefore reported nought qualified out of 1,711
    // — and a 0% qualification rate on a CRM full of qualified leads.
    //
    // The CRM records no date for the change, so the record's own date is the closest
    // honest answer: it says the lead qualified, not when.
    const reachedQualified = status === 'qualified' || status === 'converted';

    // Zoho keeps a converted lead in the module with a flag and a date rather than a
    // status, so conversion has to be read from those and not inferred from the status
    // text — which still says whatever it said the day the lead was converted.
    const convertedAt = m.converted ? new Date(String(m.convertedAt ?? '')) : null;
    const converted = convertedAt && !Number.isNaN(convertedAt.getTime()) ? convertedAt : null;

    return [
      name.firstName,
      name.lastName,
      importedEmail(m.email),
      str(m.phone),
      str(m.companyName),
      str(m.title),
      str(m.message),
      m.converted ? 'converted' : status,
      // Kept beside the mapped status, not instead of it: the CRM page groups by this
      // team's own wording and the shared vocabulary cannot express it.
      str(m.status),
      sourceDetail,
      sourceType,
      channelSlug ? (channelIdBySlug.get(channelSlug) ?? null) : null,
      str(m.ownerEmail),
      // A converted lead was qualified on the way through, whatever its status says.
      reachedQualified || converted ? (converted ?? createdAtOf(p)) : null,
      converted,
      createdAtOf(p),
      providerId,
      externalId,
    ];
  });
  const leadsTouched = await bulkUpsert(
    'lead',
    ['firstName', 'lastName', 'email', 'phone', 'companyName', 'title', 'message', 'status', 'sourceStatus', 'sourceDetail', 'sourceType', 'channelId', 'ownerEmail', 'qualifiedAt', 'convertedAt', 'createdAt', 'source', 'externalId'],
    leadRows,
    '"source", "externalId"',
    { status: '"LeadStatus"', sourceType: '"SourceType"', qualifiedAt: 'timestamp(3)', convertedAt: 'timestamp(3)', createdAt: 'timestamp(3)' },
  );
  written += leadsTouched.length;

  // ── deals ───────────────────────────────────────────────────────────────────
  if (dealPoints.length) {
    // Opportunity.pipelineId and .stageId are both required, so a deal cannot be written
    // without a pipeline to put it in. Rather than inventing one, the deals are skipped —
    // and because this count is reported separately on the card, a skip shows up as a
    // smaller number instead of a silent success.
    const pipeline =
      (await db().pipeline.findFirst({
        where: { isDefault: true },
        select: { id: true, stages: { select: STAGE_SELECT } },
      })) ??
      (await db().pipeline.findFirst({
        select: { id: true, stages: { select: STAGE_SELECT } },
        orderBy: { createdAt: 'asc' },
      }));

    if (pipeline?.stages.length) {
      const dealRows: unknown[][] = [];

      // What a deal with no currency of its own is counted in.
      //
      // Not USD. The amount has to be stored in some currency, and tagging an unknown one
      // as USD is what put Meta's rupee spend on the page multiplied by the exchange rate.
      // The workspace's own reporting currency is the one label that cannot do that: it
      // converts by a factor of one, so an unknown amount is counted at face value rather
      // than inflated by a rate it never earned.
      const reporting = (await currencySettings()).reporting;
      let currencyless = 0;

      for (const p of dealPoints) {
        const m = meta(p);
        const externalId = p.entityId as string;
        const sourceStage = str(m.stage);
        const stage = matchStage(pipeline.stages, sourceStage);
        if (!stage) continue;

        const dealCurrency = str(m.currency) ?? reporting;
        if (!str(m.currency)) currencyless++;

        const closing = str(m.closingDate);
        const closingDate = closing ? new Date(closing) : null;
        const accountId = str(m.accountId);
        const contactId = str(m.contactId);

        // A deal in a won or lost stage is closed, and Closing_Date is the day it closed.
        //
        // Left null when the CRM has no date, never today's: 982 won deals carry no
        // Closing_Date, and stamping them with the moment of the import dropped them all
        // into whichever month the sync happened to run in.
        const closed = stage.isWon || stage.isLost;
        const validClosing = closingDate && !Number.isNaN(closingDate.getTime()) ? closingDate : null;

        // The deal's own Lead_Source, mapped the same way a lead's is.
        //
        // Zoho puts a source on the deal record as well as the lead, and this is the only
        // one most deals have: 6,886 of 7,810 here were never converted from a lead, so
        // walking deal -> lead -> channel left 88% of the revenue attributed to nothing
        // while the answer sat on the deal itself.
        const dealSource = str(m.leadSource);
        const dealChannelSlug = channelSlugFor(leadSourceType(dealSource), dealSource);

        dealRows.push([
          p.entityLabel ?? externalId,
          pipeline.id,
          stage.id,
          Number(m.amount) || 0,
          dealCurrency,
          Number(m.probability) || stage.probability,
          stage.isLost ? str(m.lostReason) : null,
          validClosing,
          closed ? validClosing : null,
          accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
          contactId ? (contactIdByExternal.get(contactId) ?? null) : null,
          dealSource,
          dealChannelSlug ? (channelIdBySlug.get(dealChannelSlug) ?? null) : null,
          // Kept because a stage that fails to match is otherwise invisible: every deal
          // lands in the first open stage and the import looks like it worked. With the
          // CRM's own wording stored beside the mapped stage, a mismatch is one query away.
          sourceStage ? JSON.stringify({ stage: sourceStage }) : null,
          str(m.ownerEmail),
          createdAtOf(p),
          providerId,
          externalId,
        ]);
      }

      // Said out loud rather than absorbed: a silent default is the whole failure mode
      // being avoided here, and a count in the log is what makes it findable.
      if (currencyless) {
        console.warn(
          `[${providerId}] ${currencyless} deals had no currency and were counted as ${reporting}.`,
        );
      }

      const dealsTouched = await bulkUpsert(
        'opportunity',
        ['name', 'pipelineId', 'stageId', 'value', 'currency', 'probability', 'lostReason', 'expectedCloseDate', 'closedAt', 'companyId', 'contactId', 'sourceDetail', 'channelId', 'metadata', 'ownerEmail', 'createdAt', 'source', 'externalId'],
        dealRows,
        '"source", "externalId"',
        { value: 'numeric', probability: 'int', expectedCloseDate: 'timestamp(3)', closedAt: 'timestamp(3)', metadata: 'jsonb', createdAt: 'timestamp(3)' },
      );
      written += dealsTouched.length;
    }
  }

  return written;
}

/** How long before expiry a credential is renewed. Comfortably longer than any
 *  plausible gap between syncs, so a token is never used on its last day. */
const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Renews an expiring credential in place and returns the one to use for this sync.
 *
 * Providers that mint a short-lived access token per sync (Google, Zoho) implement no
 * refresh() and fall straight through. Meta holds a ~60-day token that simply stops
 * working, so without this a connection silently dies two months after it was made.
 */
async function renewIfNearExpiry(
  provider: ReturnType<typeof requireProvider>,
  integrationId: string,
  credential: string,
  expiresAt: Date | null,
): Promise<string> {
  if (!provider.refresh || !expiresAt) return credential;
  if (expiresAt.getTime() - Date.now() > RENEW_WITHIN_MS) return credential;

  const renewed = await provider.refresh(credential);
  if (!renewed) return credential;

  const sealed = seal(renewed.secret);
  await db().integrationCredential.update({
    where: { integrationId },
    data: { ...sealed, expiresAt: renewed.expiresAt ?? null },
  });

  return renewed.secret;
}

/**
 * Turns `outreach_sequence`, `outreach_step`, `outreach_prospect` and
 * `outreach_engagement` points into real Sequence, SequenceStep and Prospect rows.
 *
 * The Outreach page reads those three tables and nothing else — it has never read
 * metric_snapshot — so without this a mail provider could sync perfectly and the page
 * would still show only the seeder's three invented sequences.
 *
 * Rows match on (source, externalId), so a re-sync updates in place.
 */
async function writeOutreach(providerId: string, points: MetricPoint[]): Promise<number> {
  const sequencePoints = points.filter((p) => p.entityType === 'outreach_sequence' && p.entityId);
  const stepPoints = points.filter((p) => p.entityType === 'outreach_step' && p.entityId);
  const prospectPoints = points.filter((p) => p.entityType === 'outreach_prospect' && p.entityId);
  const engagementPoints = points.filter((p) => p.entityType === 'outreach_engagement' && p.entityId);

  if (!sequencePoints.length && !stepPoints.length && !prospectPoints.length && !engagementPoints.length) {
    return 0;
  }

  let written = 0;

  // ── sequences ───────────────────────────────────────────────────────────────
  // Only the `record` points carry a name; the rest are the campaign's totals, which
  // belong in metric_snapshot and have no column on Sequence.
  const sequenceRows = sequencePoints
    .filter((p) => p.metricKey === 'record')
    .map((p) => [p.entityLabel ?? (p.entityId as string), str(meta(p).status) ?? 'draft', providerId, p.entityId]);

  const sequences = await bulkUpsert(
    'sequence',
    ['name', 'status', 'source', 'externalId'],
    sequenceRows,
    '"source", "externalId"',
  );
  const sequenceIdByExternal = new Map(sequences.map((r) => [r.externalId ?? '', r.id]));
  written += sequences.length;

  // A slice that carries prospects but not their sequence — the pull resumed mid-campaign
  // — still needs the sequence's id to hang them off.
  const referenced = new Set(
    [...stepPoints, ...prospectPoints, ...engagementPoints]
      .map((p) => str(meta(p).sequenceExternalId))
      .filter((v): v is string => !!v && !sequenceIdByExternal.has(v)),
  );
  if (referenced.size) {
    const known = await db().sequence.findMany({
      where: { source: providerId, externalId: { in: [...referenced] } },
      select: { id: true, externalId: true },
    });
    for (const s of known) if (s.externalId) sequenceIdByExternal.set(s.externalId, s.id);
  }

  // ── steps ───────────────────────────────────────────────────────────────────
  // SequenceStep is keyed on (sequenceId, position), which is the platform's own notion of
  // a step, so no externalId of its own is needed.
  const stepRows: unknown[][] = [];
  for (const p of stepPoints) {
    const sequenceId = sequenceIdByExternal.get(str(meta(p).sequenceExternalId) ?? '');
    if (!sequenceId) continue;

    const m = meta(p);
    stepRows.push([
      sequenceId,
      Number(m.position) || 1,
      Number(m.waitDays) || 0,
      str(m.subject) ?? '',
      str(m.body) ?? '',
      'email',
    ]);
  }
  const steps = await bulkUpsert(
    'sequence_step',
    ['sequenceId', 'position', 'waitDays', 'subject', 'body', 'channel'],
    stepRows,
    '"sequenceId", "position"',
    { position: 'int', waitDays: 'int' },
    false,
  );
  written += steps.length;

  // ── prospects ───────────────────────────────────────────────────────────────
  // Prospect carries a second unique key, (sequenceId, email), which a bulk insert cannot
  // negotiate at the same time as (source, externalId): a lead whose address is already in
  // the sequence under a different id would abort the batch on the wrong index. Those are
  // resolved first, and are rare.
  const prospectRows: unknown[][] = [];
  const collisions: { id: string; data: Record<string, unknown> }[] = [];

  if (prospectPoints.length) {
    const wanted = prospectPoints
      .map((p) => {
        const sequenceId = sequenceIdByExternal.get(str(meta(p).sequenceExternalId) ?? '');
        // Lower-cased for the same reason contacts are, and it has to match: replies and
        // bounces arrive from a separate endpoint keyed on the address, so a prospect
        // stored in the CRM's casing would never be matched to its own engagement.
        const email = importedEmail(meta(p).email);
        return sequenceId && email ? { p, sequenceId, email } : null;
      })
      .filter((v): v is { p: MetricPoint; sequenceId: string; email: string } => !!v);

    // One OR branch per prospect, and Postgres caps a statement at 65,535 bind
    // parameters — a campaign of a few thousand leads blew straight past it. Looked up
    // in slices so the batch size, not the campaign size, decides the parameter count.
    const LOOKUP_CHUNK = 1000;
    const existing: { id: string; sequenceId: string; email: string; source: string | null; externalId: string | null }[] = [];
    for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
      const slice = wanted.slice(i, i + LOOKUP_CHUNK);
      existing.push(
        ...(await db().prospect.findMany({
          where: { OR: slice.map((w) => ({ sequenceId: w.sequenceId, email: w.email })) },
          select: { id: true, sequenceId: true, email: true, source: true, externalId: true },
        })),
      );
    }
    const byPair = new Map(existing.map((r) => [`${r.sequenceId}|${r.email}`, r]));

    for (const { p, sequenceId, email } of wanted) {
      const m = meta(p);
      const externalId = p.entityId as string;
      const data = {
        sequenceId,
        email,
        firstName: str(m.firstName),
        lastName: str(m.lastName),
        companyName: str(m.companyName),
        status: prospectStatusOf(str(m.status)),
      };

      const clash = byPair.get(`${sequenceId}|${email}`);
      const alreadyOurs = clash?.source === providerId && clash?.externalId === externalId;

      if (clash && !alreadyOurs) {
        collisions.push({ id: clash.id, data: { ...data, source: providerId, externalId } });
      } else {
        prospectRows.push([
          data.sequenceId,
          data.email,
          data.firstName,
          data.lastName,
          data.companyName,
          data.status,
          providerId,
          externalId,
        ]);
      }
    }
  }

  for (const c of collisions) {
    await db().prospect.update({ where: { id: c.id }, data: c.data });
    written++;
  }

  const prospects = await bulkUpsert(
    'prospect',
    ['sequenceId', 'email', 'firstName', 'lastName', 'companyName', 'status', 'source', 'externalId'],
    prospectRows,
    '"source", "externalId"',
    { status: '"ProspectStatus"' },
  );
  written += prospects.length;

  // Outreach and the CRM are two lists of the same people, and nothing joined them: every
  // prospect sat with a null contact, so a reply in a campaign told you nothing about the
  // company it came from. Matched on address, which is the only identifier both systems
  // agree on.
  //
  // Set once and left alone — a contact deliberately reassigned here should not be undone
  // by the next sync.
  await db().$executeRawUnsafe(
    `UPDATE prospect p
     SET "contactId" = c.id
     FROM contact c
     WHERE p.source = $1
       AND p."contactId" IS NULL
       AND p.email IS NOT NULL
       AND lower(c.email) = lower(p.email)`,
    providerId,
  );

  // ── engagement ──────────────────────────────────────────────────────────────
  // Replies and bounces arrive from a different endpoint, keyed by address rather than by
  // lead id, so they are applied as a status upgrade on top of the prospects above.
  for (const p of engagementPoints) {
    const m = meta(p);
    const sequenceId = sequenceIdByExternal.get(str(m.sequenceExternalId) ?? '');
    const email = importedEmail(m.email);
    if (!sequenceId || !email) continue;

    const status = prospectStatusOf(null, {
      replied: !!m.replied,
      bounced: !!m.bounced,
      unsubscribed: !!m.unsubscribed,
    });
    // Nothing happened to this lead worth overriding the campaign's own state with.
    if (status === 'pending') continue;

    const updated = await db().prospect.updateMany({
      where: { sequenceId, email },
      data: { status },
    });
    written += updated.count;
  }

  return written;
}

/**
 * How long one sync request may spend fetching before it saves its place and returns.
 *
 * Under Vercel's 300s function ceiling with room for the final write and the response.
 * A pull that needs longer is not an error — it comes back with a cursor and the caller
 * calls again, so no amount of data can turn into a timeout.
 */
const SYNC_BUDGET_MS = 230_000;

/**
 * How long a run may hold the sync lock before another is allowed to take it.
 *
 * A serverless function can be killed without ever clearing `state`, and a provider left
 * permanently "syncing" would be a provider that can never sync again. The longest a run
 * can legitimately live is the route's maxDuration (300s), so anything past double that
 * is dead rather than slow.
 */
const SYNC_LEASE_MS = 10 * 60 * 1000;

/**
 * Takes the sync lock, or refuses.
 *
 * Two runs of the same provider both read the same cursor, fetch the same pages and then
 * race to write it back — the loser's progress is lost and a long backfill starts over.
 * Easy to cause: clicking Sync now while the card already says Syncing, or clicking
 * during the nightly cron.
 *
 * Written as a conditional updateMany rather than a read-then-write so the check and the
 * claim are one statement. Reading the state first and updating after leaves the window
 * this is meant to close.
 */
async function claimSync(integrationId: string, providerName: string): Promise<void> {
  const claimed = await db().integration.updateMany({
    where: {
      id: integrationId,
      OR: [{ state: { not: 'syncing' } }, { updatedAt: { lt: new Date(Date.now() - SYNC_LEASE_MS) } }],
    },
    data: { state: 'syncing' },
  });

  if (claimed.count === 0) {
    throw new IntegrationError(
      `${providerName} is already syncing. It will carry on from where it stopped — no need to start another.`,
    );
  }
}

export async function sync(id: string, days = 30) {
  const provider = requireProvider(id);

  const integration = await db().integration.findUnique({
    where: { provider: id },
    select: {
      id: true,
      state: true,
      config: true,
      syncCursor: true,
      syncedThrough: true,
      credential: { select: { ciphertext: true, iv: true, authTag: true, expiresAt: true } },
    },
  });

  if (!integration?.credential) {
    throw new IntegrationError(`${provider.name} is not connected.`);
  }

  await claimSync(integration.id, provider.name);

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);

  try {
    let credential = open(integration.credential);
    credential = await renewIfNearExpiry(provider, integration.id, credential, integration.credential.expiresAt);

    const config = (integration.config as Record<string, unknown>) ?? {};

    const outcome = provider.syncPaged
      ? await runPaged(provider, integration, credential, config, { from, to })
      : await runWhole(provider, integration, credential, config, { from, to });

    await db().integration.update({
      where: { id: integration.id },
      data: {
        state: 'connected',
        lastSyncAt: new Date(),
        lastSyncRows: outcome.rows,
        lastError: null,
        lastErrorAt: null,
      },
    });

    return outcome;
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : ((e as Error).message ?? 'Sync failed.');
    await db().integration.update({
      where: { id: integration.id },
      data: { state: 'error', lastError: message, lastErrorAt: new Date() },
    });
    await dispatch({ type: 'integration.sync_failed', provider: id, message });
    throw new IntegrationError(message);
  }
}

/** A provider that returns everything in one call. */
async function runWhole(
  provider: ReturnType<typeof requireProvider>,
  integration: { id: string },
  credential: string,
  config: Record<string, unknown>,
  range: DateRange,
): Promise<SyncResult> {
  if (!provider.sync) {
    throw new IntegrationError(`${provider.name} implements neither sync nor syncPaged.`);
  }
  const points = await provider.sync(credential, config, range);
  const counts = await persist(provider, integration.id, config, points);
  return { rows: counts.rows, detail: describe(counts), done: true };
}

/**
 * A provider pulled in slices.
 *
 * Each slice is written and materialised before the next is fetched, so a run that stops
 * at the deadline leaves real, visible rows behind rather than nothing. The cursor is
 * saved after every slice for the same reason: a crash costs one slice, not the backfill.
 */
async function runPaged(
  provider: ReturnType<typeof requireProvider>,
  integration: { id: string; syncCursor: unknown; syncedThrough: Date | null },
  credential: string,
  config: Record<string, unknown>,
  range: DateRange,
): Promise<SyncResult> {
  const startedAt = new Date();
  const deadline = Date.now() + SYNC_BUDGET_MS;

  let cursor = (integration.syncCursor as SyncCursor | null) ?? null;

  // Mid-backfill, keep pulling everything: a watermark applied now would skip the records
  // the backfill has not reached yet. The watermark only takes effect on a fresh pass.
  const since = cursor ? null : integration.syncedThrough;

  const total = { rows: 0, campaignDays: 0, socialRows: 0, seoRows: 0, crmRows: 0, linkedRows: 0, activityRows: 0, revenueRows: 0, outreachRows: 0 };

  do {
    const slice = await provider.syncPaged!(credential, config, { cursor, since, deadline, range });
    const counts = await persist(provider, integration.id, config, slice.points);

    total.rows += counts.rows;
    total.campaignDays += counts.campaignDays;
    total.socialRows += counts.socialRows;
    total.seoRows += counts.seoRows;
    total.crmRows += counts.crmRows;
    total.outreachRows += counts.outreachRows;

    cursor = slice.cursor;
    await db().integration.update({
      where: { id: integration.id },
      data: { syncCursor: (cursor ?? Prisma.DbNull) as Prisma.InputJsonValue },
    });
  } while (cursor && Date.now() < deadline);

  const done = cursor === null;

  if (done) {
    // Stamped with when the pass STARTED, not when it ended. Anything modified while it
    // was running falls inside the next window instead of into the gap between them.
    await db().integration.update({
      where: { id: integration.id },
      data: { syncedThrough: startedAt },
    });
  }

  const detail = done
    ? `${describe(total)}${since ? ' (changes only).' : '.'}`
    : `${describe(total)} so far — more to fetch, continuing.`;

  return { rows: total.rows, detail, done };
}

type Counts = {
  rows: number;
  campaignDays: number;
  socialRows: number;
  seoRows: number;
  crmRows: number;
  linkedRows: number;
  activityRows: number;
  revenueRows: number;
  outreachRows: number;
};

/**
 * Turns `crm_task` and `crm_activity` points into Task and Activity rows.
 *
 * Zoho keeps the work log in three modules — Tasks, Calls, Events — and until now none of
 * it was imported, so the activity feed and task list showed only what the seeder wrote.
 *
 * Both tables hang off whichever record the activity was about. Zoho names it in What_Id
 * (a lead or a deal) and Who_Id (a contact) without saying which module either belongs
 * to, so the ids are resolved here against the records already imported: whatever matches
 * wins, and an activity whose subject was never imported still lands, unattached, rather
 * than being dropped.
 */
async function writeCrmActivity(providerId: string, points: MetricPoint[]): Promise<number> {
  const taskPoints = points.filter((p) => p.entityType === 'crm_task' && p.entityId);
  const activityPoints = points.filter((p) => p.entityType === 'crm_activity' && p.entityId);
  if (!taskPoints.length && !activityPoints.length) return 0;

  const referenced = new Set<string>();
  for (const p of [...taskPoints, ...activityPoints]) {
    const m = meta(p);
    const what = str(m.whatId);
    const who = str(m.whoId);
    if (what) referenced.add(what);
    if (who) referenced.add(who);
  }

  // One lookup per table over the whole referenced set, sliced so a large pull cannot
  // exceed Postgres's bind-parameter limit.
  const LOOKUP_CHUNK = 1000;
  const ids = [...referenced];
  const leadBy = new Map<string, string>();
  const contactBy = new Map<string, string>();
  const dealBy = new Map<string, string>();
  const dealCompany = new Map<string, string | null>();

  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const slice = ids.slice(i, i + LOOKUP_CHUNK);
    const where = { source: providerId, externalId: { in: slice } };
    const [leads, contacts, deals] = await Promise.all([
      db().lead.findMany({ where, select: { id: true, externalId: true } }),
      db().contact.findMany({ where, select: { id: true, externalId: true } }),
      db().opportunity.findMany({ where, select: { id: true, externalId: true, companyId: true } }),
    ]);
    for (const r of leads) if (r.externalId) leadBy.set(r.externalId, r.id);
    for (const r of contacts) if (r.externalId) contactBy.set(r.externalId, r.id);
    for (const r of deals) {
      if (!r.externalId) continue;
      dealBy.set(r.externalId, r.id);
      dealCompany.set(r.externalId, r.companyId);
    }
  }

  /** Whatever the two Zoho ids turn out to point at. A contact reference also carries no
   *  company of its own, so only a deal can supply one. */
  const link = (whatId: string | null, whoId: string | null) => {
    const opportunityId = whatId ? (dealBy.get(whatId) ?? null) : null;
    const leadId = (whatId && leadBy.get(whatId)) || (whoId && leadBy.get(whoId)) || null;
    const contactId = (whoId && contactBy.get(whoId)) || (whatId && contactBy.get(whatId)) || null;
    const companyId = whatId ? (dealCompany.get(whatId) ?? null) : null;
    return { opportunityId, leadId, contactId, companyId };
  };

  let written = 0;

  if (taskPoints.length) {
    const rows: unknown[][] = [];
    for (const p of taskPoints) {
      const m = meta(p);
      const status = taskStatus(str(m.status));
      const due = str(m.dueDate);
      const dueDate = due ? new Date(due) : null;
      const { opportunityId, leadId, contactId, companyId } = link(str(m.whatId), str(m.whoId));

      rows.push([
        str(m.title) ?? p.entityLabel ?? (p.entityId as string),
        str(m.detail),
        status,
        taskPriority(str(m.priority)),
        dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
        str(m.ownerEmail),
        str(m.createdByEmail),
        // Zoho records no completion time, so a done task is dated by the day it was last
        // touched rather than left null, which the task list reads as still open.
        status === 'done' ? p.date : null,
        leadId,
        contactId,
        companyId,
        opportunityId,
        providerId,
        p.entityId as string,
      ]);
    }

    const touched = await bulkUpsert(
      'task',
      ['title', 'detail', 'status', 'priority', 'dueDate', 'assigneeEmail', 'createdByEmail', 'completedAt', 'leadId', 'contactId', 'companyId', 'opportunityId', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { status: '"TaskStatus"', priority: '"Priority"', dueDate: 'timestamp(3)', completedAt: 'timestamp(3)' },
    );
    written += touched.length;
  }

  if (activityPoints.length) {
    const rows: unknown[][] = [];
    for (const p of activityPoints) {
      const m = meta(p);
      const { opportunityId, leadId, contactId, companyId } = link(str(m.whatId), str(m.whoId));

      rows.push([
        str(m.kind) === 'meeting' ? 'meeting' : 'call',
        str(m.summary) ?? p.entityLabel ?? (p.entityId as string),
        str(m.ownerEmail),
        JSON.stringify({
          detail: str(m.detail),
          direction: str(m.direction),
          duration: str(m.duration),
          endsAt: str(m.endsAt),
        }),
        leadId,
        contactId,
        companyId,
        opportunityId,
        // The feed is ordered by createdAt, so it has to be when the call or meeting
        // happened. Left to default(now()) every imported activity would stack up on the
        // day of the sync.
        p.date,
        providerId,
        p.entityId as string,
      ]);
    }

    const touched = await bulkUpsert(
      'activity',
      ['type', 'summary', 'actorEmail', 'detail', 'leadId', 'contactId', 'companyId', 'opportunityId', 'createdAt', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { type: '"ActivityType"', detail: 'jsonb', createdAt: 'timestamp(3)' },
      false,
    );
    written += touched.length;
  }

  return written;
}

/**
 * Joins a converted lead to what it became.
 *
 * Zoho records the contact, account and deal a lead converted into, and without them the
 * three are unrelated rows: nothing can say which lead earned which revenue, and the
 * funnel's last step is an assertion rather than a join.
 *
 * Run as its own pass, after the records exist. The lead may be fetched pages before the
 * deal it points at — the modules are pulled one after another — so resolving the links
 * inline would drop every reference that pointed forwards.
 *
 * Set once and left alone: a link corrected by hand here should survive the next sync.
 */
async function linkConvertedLeads(providerId: string, points: MetricPoint[]): Promise<number> {
  const rows = points
    .filter((p) => p.entityType === 'crm_lead' && p.entityId && meta(p).converted)
    .map((p) => {
      const m = meta(p);
      return {
        externalId: p.entityId as string,
        contactId: str(m.convertedContactId),
        accountId: str(m.convertedAccountId),
        dealId: str(m.convertedDealId),
      };
    })
    .filter((r) => r.contactId || r.accountId || r.dealId);

  if (!rows.length) return 0;

  let linked = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => [providerId, r.externalId, r.contactId, r.accountId, r.dealId]);
    const placeholders = values
      .map((_, n) => `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5})`)
      .join(', ');

    // A single statement per chunk, joining through the external ids both sides already
    // carry. COALESCE keeps a link that is already set, including one set by hand.
    linked += await db().$executeRawUnsafe(
      `WITH ref (source, lead_external, contact_external, account_external, deal_external)
         AS (VALUES ${placeholders})
       UPDATE lead l
          SET "contactId"  = COALESCE(l."contactId", c.id),
              "companyId"  = COALESCE(l."companyId", co.id)
         FROM ref
         LEFT JOIN contact c  ON c.source = ref.source  AND c."externalId" = ref.contact_external
         LEFT JOIN company co ON co.source = ref.source AND co."externalId" = ref.account_external
        WHERE l.source = ref.source
          AND l."externalId" = ref.lead_external
          AND (c.id IS NOT NULL OR co.id IS NOT NULL)`,
      ...values.flat(),
    );

    // The deal points back at the lead rather than the other way round: a lead produces
    // at most one deal here, but the column lives on Opportunity.
    await db().$executeRawUnsafe(
      `WITH ref (source, lead_external, contact_external, account_external, deal_external)
         AS (VALUES ${placeholders})
       UPDATE opportunity o
          SET "leadId" = l.id
         FROM ref
         JOIN lead l ON l.source = ref.source AND l."externalId" = ref.lead_external
        WHERE o.source = ref.source
          AND o."externalId" = ref.deal_external
          AND o."leadId" IS NULL`,
      ...values.flat(),
    );
  }

  return linked;
}

/**
 * Derives Customer and RevenueEntry rows from deals sitting in a won stage.
 *
 * There is no billing integration, so revenue has no other source. The CRM already knows
 * what closed and for how much, and the Dashboard and Revenue pages read these two tables
 * — without this step they stay empty however complete the CRM import is.
 *
 * Done in SQL rather than a read-modify-write loop because it runs over every won deal on
 * every sync: 7,746 round trips would not finish inside a serverless function.
 *
 * Idempotent in both directions. A revenue entry is keyed on its opportunity, so a
 * re-sync corrects the amount instead of adding a second row; and a deal dragged back out
 * of a won stage has its derived revenue removed, which a pure upsert would have left
 * behind as a sale that never happened.
 */
async function writeRevenueFromWonDeals(): Promise<number> {
  // Customers whose deal stopped qualifying, removed before the rest runs.
  //
  // The claim above that this is "idempotent in both directions" held for revenue and not
  // for customers: the insert below only ever adds or lowers a date, so a customer derived
  // from a deal that is no longer won — or that lost its close date — was left standing
  // with whatever wonAt it was first given.
  //
  // It went wrong exactly that way. An earlier import stamped won deals that had no
  // Closing_Date with the date of the import; fixing that left those deals with a null
  // closedAt, which drops them out of the SELECT entirely, so 490 customer rows kept a
  // wonAt of the day the import ran. The CRM page then read 490 new customers on a day
  // that had four, and showed it as a 48,900% rise.
  //
  // Only rows this materialiser owns are touched — a customer with no opportunityId was
  // made by hand and is nobody's derived row.
  await db().$executeRawUnsafe(`
    DELETE FROM customer c
    WHERE c."opportunityId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity o
        JOIN pipeline_stage s ON s.id = o."stageId"
        WHERE o.id = c."opportunityId"
          AND s."isWon"
          AND o.value > 0
          AND o."closedAt" IS NOT NULL
          AND o."closedAt"::date <= current_date
      )
  `);

  // One customer per company — the schema allows only one — dated by that company's
  // earliest win, so "customer since" means what it says.
  //
  // The same three rules revenue is derived by, because a customer and their revenue
  // have to agree about what a win is. They did not: revenue excluded zero-value deals
  // and deals closing in the future, while this counted them — so 129 people whose deal
  // closes as late as 2027, and 478 whose deal is worth nothing, were customers with no
  // revenue. CAC divided spend by an inflated count and revenue-per-customer came out
  // low. Nothing is lost by waiting: this runs on every sync, so a future-dated win
  // becomes a customer by itself on the day its date arrives.
  await db().$executeRawUnsafe(`
    INSERT INTO customer (id, "companyId", "opportunityId", "wonAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, d."companyId", d.id, d.won_at, now(), now()
    FROM (
      SELECT DISTINCT ON (o."companyId")
             o."companyId", o.id, o."closedAt" AS won_at
      FROM opportunity o
      JOIN pipeline_stage s ON s.id = o."stageId"
      WHERE s."isWon"
        AND o."companyId" IS NOT NULL
        AND o.value > 0
        AND o."closedAt" IS NOT NULL
        AND o."closedAt"::date <= current_date
      ORDER BY o."companyId", o."closedAt" ASC
    ) d
    ON CONFLICT ("companyId") DO UPDATE
      SET "wonAt" = LEAST(customer."wonAt", EXCLUDED."wonAt"), "updatedAt" = now()
  `);

  // A deal that moved back out of a won stage, lost its value, or had its close date
  // pushed into the future must not leave revenue behind. Only derived rows are touched —
  // manual revenue carries no opportunity.
  await db().$executeRawUnsafe(`
    DELETE FROM revenue_entry r
    WHERE r."opportunityId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity o
        JOIN pipeline_stage s ON s.id = o."stageId"
        WHERE o.id = r."opportunityId"
          AND s."isWon"
          AND o.value > 0
          AND o."closedAt" IS NOT NULL
          AND o."closedAt"::date <= current_date
      )
  `);

  // Three exclusions, all so the total means money actually earned.
  //
  // Zero-value deals: a won deal with no amount is a bookkeeping gap in the CRM, and
  // importing it as £0 would drag the average down as if the work had been given away.
  //
  // Future close dates: 656 won deals here close as late as 2027, and counting them today
  // would put £2.9m of unearned money into the revenue total. They are not lost — this
  // runs on every sync, so each one appears by itself on the day its date arrives.
  //
  // No close date at all: 982 won deals have none. Revenue has to be dated, and the only
  // dates available are the import's own — which would file the money under whichever
  // month the sync ran in and move it again on the next re-import. Left out until the CRM
  // says when the deal closed.
  return db().$executeRawUnsafe(`
    INSERT INTO revenue_entry (id, "customerId", date, amount, currency, kind, "opportunityId", "campaignId", "channelId", "createdAt")
    SELECT gen_random_uuid()::text, c.id, o."closedAt"::date,
           o.value, o.currency, 'one_time', o.id, o."campaignId",
           COALESCE(l."channelId", o."channelId"), now()
    FROM opportunity o
    -- The channel the originating lead arrived through, so revenue can be attributed to
    -- the thing that produced it. Left join: a deal created directly has no lead.
    --
    -- The lead's channel wins where there is one: it records how the person first reached
    -- the firm, which is the question the Marketing page asks. The deal's own channel is
    -- the fallback, and for most of this CRM it is the only answer there is — 6,886 of
    -- 7,810 deals have no lead at all, so without it 88% of the revenue was unattributed.
    LEFT JOIN lead l ON l.id = o."leadId"
    JOIN pipeline_stage s ON s.id = o."stageId"
    JOIN customer c ON c."companyId" = o."companyId"
    WHERE s."isWon"
      AND o."companyId" IS NOT NULL
      AND o.value > 0
      AND o."closedAt" IS NOT NULL
      AND o."closedAt"::date <= current_date
    ON CONFLICT ("opportunityId") DO UPDATE
      SET amount = EXCLUDED.amount,
          date = EXCLUDED.date,
          currency = EXCLUDED.currency,
          "channelId" = COALESCE(EXCLUDED."channelId", revenue_entry."channelId")
  `);
}

/** metric_snapshot first — the honest archive of what the provider reported — then the
 *  materialisers that populate the tables the pages actually read. */
async function persist(
  provider: ReturnType<typeof requireProvider>,
  integrationId: string,
  config: Record<string, unknown>,
  points: MetricPoint[],
): Promise<Counts> {
  return {
    rows: await writePoints(provider.id, points),
    campaignDays: await writeCampaignSpend(provider, points),
    socialRows: await writeSocialActivity(integrationId, points),
    seoRows: await writeSeoRows(provider, config, points),
    crmRows: await writeCrmRecords(provider.id, points),
    // After the records, and before revenue: revenue is attributed through these links.
    linkedRows: await linkConvertedLeads(provider.id, points),
    // After the CRM records too: activities are attached to the leads and deals above.
    activityRows: await writeCrmActivity(provider.id, points),
    // After the CRM records, never before: it reads the deals that step just wrote.
    revenueRows: await writeRevenueFromWonDeals(),
    outreachRows: await writeOutreach(provider.id, points),
  };
}

/**
 * Each materialiser is named separately so a card cannot report a healthy metric row
 * count while the tables the pages actually read stayed empty — which is the failure Meta
 * Ads shipped with once, and Zoho CRM after it.
 */
function describe(c: Counts): string {
  const materialised = [
    c.campaignDays ? `${c.campaignDays} campaign-days` : null,
    c.socialRows ? `${c.socialRows} social rows` : null,
    c.seoRows ? `${c.seoRows} SEO rows` : null,
    c.crmRows ? `${c.crmRows} CRM records` : null,
    c.linkedRows ? `${c.linkedRows} conversions linked` : null,
    c.activityRows ? `${c.activityRows} activities and tasks` : null,
    c.revenueRows ? `${c.revenueRows} revenue entries` : null,
    c.outreachRows ? `${c.outreachRows} outreach rows` : null,
  ].filter(Boolean);

  return materialised.length
    ? `Wrote ${c.rows} metric rows, ${materialised.join(', ')}`
    : `Wrote ${c.rows} metric rows`;
}

/**
 * Pushes a completed or reopened task back to the integration that owns it.
 *
 * Every task in this database came from a CRM sync, and writeCrmActivity upserts `status`
 * and `completedAt` from the vendor on every run — so a tick that only landed here was
 * undone the moment Zoho next touched that record, with nothing on screen saying so.
 *
 * Returns false when the provider owns no write path or is not connected: an internally
 * created task has nowhere to push to, and that is not a failure. Throws only when the
 * vendor was asked and refused, which the caller must not paper over.
 */
export async function pushTaskStatus(
  providerId: string,
  externalId: string,
  done: boolean,
): Promise<boolean> {
  const provider = getProvider(providerId);
  if (!provider?.updateTaskStatus) return false;

  const integration = await db().integration.findUnique({
    where: { provider: providerId },
    select: {
      id: true,
      credential: { select: { ciphertext: true, iv: true, authTag: true, expiresAt: true } },
    },
  });
  if (!integration?.credential) return false;

  let credential = open(integration.credential);
  credential = await renewIfNearExpiry(provider, integration.id, credential, integration.credential.expiresAt);

  await provider.updateTaskStatus(credential, externalId, done);
  return true;
}

/**
 * Pushes lead reassignments back to the integration that owns them.
 *
 * Every lead in this database came from a CRM sync, and the lead upsert writes `ownerEmail`
 * from the vendor on every run — so a reassignment that only landed here is undone by the
 * next nightly sync, with nothing on screen saying so. That makes this the load-bearing
 * half of any rebalance, not an enhancement to it.
 *
 * Returns null when the provider owns no write path or is not connected, which is not a
 * failure — it means there is nowhere to push to. Throws when the vendor was asked and
 * refused outright, which the caller must not paper over.
 */
export async function pushLeadOwners(
  providerId: string,
  updates: { externalId: string; ownerEmail: string }[],
): Promise<{ written: string[]; failed: { externalId: string; reason: string }[] } | null> {
  const provider = getProvider(providerId);
  if (!provider?.updateLeadOwners) return null;
  if (!updates.length) return { written: [], failed: [] };

  const integration = await db().integration.findUnique({
    where: { provider: providerId },
    select: {
      id: true,
      credential: { select: { ciphertext: true, iv: true, authTag: true, expiresAt: true } },
    },
  });
  if (!integration?.credential) return null;

  let credential = open(integration.credential);
  credential = await renewIfNearExpiry(provider, integration.id, credential, integration.credential.expiresAt);

  return provider.updateLeadOwners(credential, updates);
}

/**
 * Saves the non-secret settings a provider needs to sync — the ad account id, the GA4
 * property id. Separate from connect() because these are routinely corrected after the
 * OAuth handshake, and re-authorising to change a property id would be absurd.
 *
 * Merges rather than replaces, so a form submitting one field cannot silently drop
 * another provider's stored setting.
 */
export async function setConfig(
  id: string,
  input: Record<string, string>,
  actorEmail: string,
): Promise<Record<string, unknown>> {
  const provider = requireProvider(id);
  const fields = provider.configFields ?? [];
  if (!fields.length) throw new IntegrationError(`${provider.name} has no settings.`);

  const existing = await db().integration.findUnique({
    where: { provider: id },
    select: { config: true },
  });
  const config: Record<string, unknown> = {
    ...((existing?.config as Record<string, unknown> | null) ?? {}),
  };

  for (const field of fields) {
    const raw = input[field.name];
    if (raw === undefined) continue;

    let value = raw.trim();
    if (field.normalise) {
      try {
        value = field.normalise(value);
      } catch (e) {
        throw new IntegrationError((e as Error).message);
      }
    }
    if (field.required && !value) throw new IntegrationError(`${field.label} is required.`);

    config[field.name] = value;
  }

  await db().integration.upsert({
    where: { provider: id },
    create: { provider: id, state: 'disconnected', config: config as Prisma.InputJsonValue },
    update: { config: config as Prisma.InputJsonValue },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'integration.configure',
      entityType: 'integration',
      entityId: id,
      detail: config as Prisma.InputJsonValue,
    },
  });

  return config;
}

export type SyncAllResult = {
  provider: string;
  status: 'synced' | 'skipped' | 'failed';
  rows?: number;
  reason?: string;
  /** False when a backfill still has more to fetch; the next scheduled run resumes it. */
  done?: boolean;
};

/**
 * Syncs every connected provider, for the scheduler.
 *
 * Sequential on purpose: these run unattended against third-party rate limits, and a
 * handful of providers finishing a few seconds apart costs nothing. One provider
 * failing must not stop the others, so each is caught and reported rather than thrown —
 * sync() has already recorded the error against its own integration row.
 */
export async function syncAll(days = 30): Promise<SyncAllResult[]> {
  const rows = await db().integration.findMany({
    where: { credential: { isNot: null } },
    select: { provider: true, state: true },
  });

  const results: SyncAllResult[] = [];

  for (const row of rows) {
    const provider = getProvider(row.provider);
    if (!provider) {
      // A row left behind by a provider that has since been removed from the registry.
      results.push({ provider: row.provider, status: 'skipped', reason: 'Not a registered provider.' });
      continue;
    }
    if (!provider.isConfigured() || !hasEncryptionKey()) {
      results.push({ provider: row.provider, status: 'skipped', reason: 'Missing environment variables.' });
      continue;
    }

    try {
      // One slice per provider per run. A backfill that needs longer keeps its cursor
      // and resumes on the next run, rather than one large provider starving the rest.
      const { rows: written, done } = await sync(row.provider, days);
      results.push({ provider: row.provider, status: 'synced', rows: written, done });
    } catch (e) {
      const reason = (e as Error).message;
      // A provider already mid-run is not a failure — someone started it by hand and it
      // is still going. Reported as skipped so the cron log keeps meaning "something
      // broke" rather than "the two schedules overlapped".
      const busy = e instanceof IntegrationError && reason.includes('already syncing');
      results.push(
        busy
          ? { provider: row.provider, status: 'skipped', reason }
          : { provider: row.provider, status: 'failed', reason },
      );
    }
  }

  return results;
}

/**
 * Integration states change only when someone connects, disconnects or syncs — each of
 * which invalidates the `integrations` tag — so re-reading them on every navigation was
 * a round trip spent to learn nothing had changed. Four pages and the app shell call
 * this, so it was the single most repeated query in the app.
 */
export const cards = cached('integrations:cards', [TAGS.integrations], readCards);
