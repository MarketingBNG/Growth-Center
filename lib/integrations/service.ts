import { db } from '../prisma.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { hasEncryptionKey, open, seal } from '../crypto.ts';
import { dispatch } from '../events.ts';
import { leadSourceType, leadStatus, matchStage } from './crm-mapping.ts';
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
  config: Record<string, unknown> | null;
};

/**
 * One card per registered provider, whether or not it has ever been connected.
 *
 * `state` comes from the Integration row. Where a row claims `connected` but no
 * credential exists, the card reports `error` rather than the claim — a connected badge
 * with nothing behind it is the exact lie this module exists to prevent.
 */
export async function cards(): Promise<Card[]> {
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
      credential: { select: { id: true, expiresAt: true } },
    },
  });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return providerList().map((p) => {
    const row = byProvider.get(p.id);
    const hasCredential = !!row?.credential;
    const config = (row?.config as Record<string, unknown> | null) ?? {};
    const missingEnv = p.requiredEnv.filter((e) => !process.env[e.name]);

    let state = row?.state ?? 'disconnected';
    if (state === 'connected' && !hasCredential) state = 'error';

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
      config: undefined,
      // Reconnecting means starting clean. Without this the watermark survives, so the
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

async function writePoints(source: string, points: MetricPoint[]): Promise<number> {
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

  const campaignIdByExternal = new Map<string, string>();
  for (const [externalId, name] of names) {
    const row = await db().campaign.upsert({
      where: { source_externalId: { source: provider.id, externalId } },
      create: { name, channelId: channelRow.id, source: provider.id, externalId },
      update: { name },
      select: { id: true },
    });
    campaignIdByExternal.set(externalId, row.id);
  }

  // One row per campaign-day, carrying whichever of the three metrics arrived.
  type Day = { campaignId: string; date: Date; amount: number; impressions: number; clicks: number };
  const days = new Map<string, Day>();

  for (const p of relevant) {
    const campaignId = campaignIdByExternal.get(p.entityId as string);
    if (!campaignId) continue;

    const iso = p.date.toISOString().slice(0, 10);
    const key = `${campaignId}|${iso}`;
    let day = days.get(key);
    if (!day) {
      day = { campaignId, date: p.date, amount: 0, impressions: 0, clicks: 0 };
      days.set(key, day);
    }

    if (p.metricKey === 'spend') day.amount = p.value;
    else if (p.metricKey === 'impressions') day.impressions = Math.round(p.value);
    else if (p.metricKey === 'clicks') day.clicks = Math.round(p.value);
  }

  const rows = [...days.values()];
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const values = chunk.map((d) => [d.campaignId, d.date, d.amount, d.impressions, d.clicks]);
    const placeholders = values
      .map(
        (_, r) =>
          `(gen_random_uuid()::text, $${r * 5 + 1}, $${r * 5 + 2}::date, $${r * 5 + 3}::numeric, $${r * 5 + 4}::int, $${r * 5 + 5}::int)`,
      )
      .join(', ');

    await db().$executeRawUnsafe(
      `INSERT INTO marketing_spend (id, "campaignId", date, amount, impressions, clicks)
       VALUES ${placeholders}
       ON CONFLICT ("campaignId", date)
       DO UPDATE SET amount = EXCLUDED.amount,
                     impressions = EXCLUDED.impressions,
                     clicks = EXCLUDED.clicks`,
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
 * SeoPage — which is why connecting Semrush was always going to leave the SEO page fully
 * seeded. Rows written here carry `source`, so the page can tell a reported ranking from
 * an invented one sitting in the same table.
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
  type Ranking = { date: Date; position: number };
  const byKeyword = new Map<string, Ranking[]>();

  for (const p of keywordPoints) {
    if (p.metricKey !== 'position') continue;
    const keyword = p.entityId as string;
    const rankings = byKeyword.get(keyword) ?? [];
    rankings.push({ date: p.date, position: Math.round(p.value) });
    byKeyword.set(keyword, rankings);
  }

  for (const [keyword, rankings] of byKeyword) {
    const row = await db().seoKeyword.upsert({
      where: { websiteId_keyword_country: { websiteId: website.id, keyword, country: 'us' } },
      // searchVolume, difficulty and cpc are deliberately left unset. Search Console does
      // not report them, and a number invented to fill the column is exactly the kind of
      // figure this app labels rather than fabricates.
      create: { websiteId: website.id, keyword, country: 'us', source: provider.id },
      update: { source: provider.id },
      select: { id: true },
    });

    for (const ranking of rankings) {
      await db().seoKeywordRanking.upsert({
        where: { keywordId_date: { keywordId: row.id, date: ranking.date } },
        create: { keywordId: row.id, date: ranking.date, position: ranking.position },
        update: { position: ranking.position },
      });
      written++;
    }
  }

  // ── pages: one current row per URL ───────────────────────────────────────────────
  const byPage = new Map<string, Record<string, number>>();
  for (const p of pagePoints) {
    const url = p.entityId as string;
    const entry = byPage.get(url) ?? {};
    entry[p.metricKey] = p.value;
    byPage.set(url, entry);
  }

  for (const [url, m] of byPage) {
    const fields = {
      clicks: Math.round(m.clicks ?? 0),
      impressions: Math.round(m.impressions ?? 0),
      ctr: m.ctr ?? 0,
      avgPosition: m.position ?? 0,
      source: provider.id,
    };
    await db().seoPage.upsert({
      where: { websiteId_url: { websiteId: website.id, url } },
      create: { websiteId: website.id, url, ...fields },
      update: fields,
    });
    written++;
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
async function bulkUpsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
  casts: Record<string, string> = {},
): Promise<{ id: string; externalId: string | null }[]> {
  if (!rows.length) return [];

  const cols = [...columns, 'updatedAt'];
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const assignments = cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  const touched: { id: string; externalId: string | null }[] = [];

  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const values = chunk.map((r) => [...r, new Date()]);
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
       RETURNING id, "externalId"`,
      ...values.flat(),
    );
    touched.push(...returned);
  }

  return touched;
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
  const leadPoints = points.filter((p) => p.entityType === 'crm_lead' && p.entityId);
  const contactPoints = points.filter((p) => p.entityType === 'crm_contact' && p.entityId);
  const dealPoints = points.filter((p) => p.entityType === 'crm_deal' && p.entityId);
  if (!leadPoints.length && !contactPoints.length && !dealPoints.length) return 0;

  const meta = (p: MetricPoint) => (p.entityMeta ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    const t = v == null ? '' : String(v).trim();
    return t === '' ? null : t;
  };

  let written = 0;

  // ── companies ───────────────────────────────────────────────────────────────
  // Contacts and deals both reference an account by id. Written first so the rows that
  // point at them can be linked in the same pass rather than a second reconciliation.
  const accounts = new Map<string, string>();
  for (const p of [...contactPoints, ...dealPoints]) {
    const id = str(meta(p).accountId);
    const name = str(meta(p).accountName);
    if (id && name) accounts.set(id, name);
  }

  const companyRows = [...accounts].map(([externalId, name]) => [name, providerId, externalId]);
  const companies = await bulkUpsert('company', ['name', 'source', 'externalId'], companyRows, '"source", "externalId"');
  const companyIdByExternal = new Map(companies.map((r) => [r.externalId ?? '', r.id]));
  written += companies.length;

  // ── contacts ────────────────────────────────────────────────────────────────
  const contactIdByExternal = new Map<string, string>();
  if (contactPoints.length) {
    // Contact.email is globally unique, which a bulk insert cannot negotiate: a row whose
    // address already exists would abort the whole batch on the wrong index. So the
    // colliding addresses are resolved up front — rows already here are adopted (stamped
    // with this provider's id) one by one, and everything else goes out in batches.
    const emails = [...new Set(contactPoints.map((p) => str(meta(p).email)).filter((e): e is string => !!e))];
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

    const adopt: { id: string; row: Record<string, unknown>; externalId: string }[] = [];
    const fresh: unknown[][] = [];

    for (const p of contactPoints) {
      const m = meta(p);
      const externalId = p.entityId as string;
      let email = str(m.email);

      if (email && claimedInBatch.has(email)) {
        email = null;
        deduped++;
      } else if (email) {
        claimedInBatch.add(email);
      }

      const accountId = str(m.accountId);
      const row = {
        firstName: str(m.firstName) ?? p.entityLabel ?? externalId,
        lastName: str(m.lastName),
        email,
        phone: str(m.phone),
        title: str(m.title),
        companyId: accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
      };

      const clash = email ? byEmail.get(email) : undefined;
      const alreadyOurs = clash?.source === providerId && clash?.externalId === externalId;

      if (clash && !alreadyOurs) {
        adopt.push({ id: clash.id, row, externalId });
      } else {
        fresh.push([row.firstName, row.lastName, row.email, row.phone, row.title, row.companyId, providerId, externalId]);
      }
    }

    for (const a of adopt) {
      await db().contact.update({
        where: { id: a.id },
        data: { ...a.row, source: providerId, externalId: a.externalId },
      });
      contactIdByExternal.set(a.externalId, a.id);
      written++;
    }

    const touched = await bulkUpsert(
      'contact',
      ['firstName', 'lastName', 'email', 'phone', 'title', 'companyId', 'source', 'externalId'],
      fresh,
      '"source", "externalId"',
    );
    for (const t of touched) if (t.externalId) contactIdByExternal.set(t.externalId, t.id);
    written += touched.length;

    if (deduped) {
      console.warn(`[${providerId}] ${deduped} contacts imported without an email: address already used by another contact.`);
    }
  }

  // ── leads ───────────────────────────────────────────────────────────────────
  const leadRows = leadPoints.map((p) => {
    const m = meta(p);
    const externalId = p.entityId as string;
    return [
      str(m.firstName) ?? p.entityLabel ?? externalId,
      str(m.lastName),
      str(m.email),
      str(m.phone),
      str(m.companyName),
      str(m.title),
      str(m.message),
      leadStatus(str(m.status)),
      leadSourceType(str(m.leadSource)),
      providerId,
      externalId,
    ];
  });
  const leadsTouched = await bulkUpsert(
    'lead',
    ['firstName', 'lastName', 'email', 'phone', 'companyName', 'title', 'message', 'status', 'sourceType', 'source', 'externalId'],
    leadRows,
    '"source", "externalId"',
    { status: '"LeadStatus"', sourceType: '"SourceType"' },
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

      for (const p of dealPoints) {
        const m = meta(p);
        const externalId = p.entityId as string;
        const stage = matchStage(pipeline.stages, str(m.stage));
        if (!stage) continue;

        const closing = str(m.closingDate);
        const closingDate = closing ? new Date(closing) : null;
        const accountId = str(m.accountId);
        const contactId = str(m.contactId);

        dealRows.push([
          p.entityLabel ?? externalId,
          pipeline.id,
          stage.id,
          Number(m.amount) || 0,
          str(m.currency) ?? 'USD',
          Number(m.probability) || stage.probability,
          closingDate && !Number.isNaN(closingDate.getTime()) ? closingDate : null,
          accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
          contactId ? (contactIdByExternal.get(contactId) ?? null) : null,
          providerId,
          externalId,
        ]);
      }

      const dealsTouched = await bulkUpsert(
        'opportunity',
        ['name', 'pipelineId', 'stageId', 'value', 'currency', 'probability', 'expectedCloseDate', 'companyId', 'contactId', 'source', 'externalId'],
        dealRows,
        '"source", "externalId"',
        { value: 'numeric', probability: 'int', expectedCloseDate: 'timestamp(3)' },
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
 * How long one sync request may spend fetching before it saves its place and returns.
 *
 * Under Vercel's 300s function ceiling with room for the final write and the response.
 * A pull that needs longer is not an error — it comes back with a cursor and the caller
 * calls again, so no amount of data can turn into a timeout.
 */
const SYNC_BUDGET_MS = 230_000;

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

  await db().integration.update({ where: { id: integration.id }, data: { state: 'syncing' } });

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

  const total = { rows: 0, campaignDays: 0, socialRows: 0, seoRows: 0, crmRows: 0 };

  do {
    const slice = await provider.syncPaged!(credential, config, { cursor, since, deadline, range });
    const counts = await persist(provider, integration.id, config, slice.points);

    total.rows += counts.rows;
    total.campaignDays += counts.campaignDays;
    total.socialRows += counts.socialRows;
    total.seoRows += counts.seoRows;
    total.crmRows += counts.crmRows;

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

type Counts = { rows: number; campaignDays: number; socialRows: number; seoRows: number; crmRows: number };

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
  ].filter(Boolean);

  return materialised.length
    ? `Wrote ${c.rows} metric rows, ${materialised.join(', ')}`
    : `Wrote ${c.rows} metric rows`;
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
      results.push({ provider: row.provider, status: 'failed', reason: (e as Error).message });
    }
  }

  return results;
}
