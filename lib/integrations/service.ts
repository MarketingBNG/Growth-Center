import { db } from '../prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { hasEncryptionKey, open, seal } from '../crypto.ts';
import { dispatch } from '../events.ts';
import { getProvider, providerList } from './registry.ts';
import { IntegrationError, type ConfigField, type ConnectInput, type MetricPoint } from './types.ts';

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

export async function sync(id: string, days = 30) {
  const provider = requireProvider(id);

  const integration = await db().integration.findUnique({
    where: { provider: id },
    select: {
      id: true,
      state: true,
      config: true,
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

    const points = await provider.sync(
      credential,
      (integration.config as Record<string, unknown>) ?? {},
      { from, to },
    );
    const rows = await writePoints(id, points);
    const campaignDays = await writeCampaignSpend(provider, points);

    await db().integration.update({
      where: { id: integration.id },
      data: {
        state: 'connected',
        lastSyncAt: new Date(),
        lastSyncRows: rows,
        lastError: null,
        lastErrorAt: null,
      },
    });

    return {
      rows,
      detail: campaignDays
        ? `Wrote ${rows} metric rows and ${campaignDays} campaign-days.`
        : `Wrote ${rows} metric rows.`,
    };
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
      const { rows: written } = await sync(row.provider, days);
      results.push({ provider: row.provider, status: 'synced', rows: written });
    } catch (e) {
      results.push({ provider: row.provider, status: 'failed', reason: (e as Error).message });
    }
  }

  return results;
}
