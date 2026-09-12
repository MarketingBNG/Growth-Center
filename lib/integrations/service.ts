import { db } from '../prisma.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { hasEncryptionKey, open, seal } from '../crypto.ts';
import { dispatch } from '../events.ts';
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
import { writePoints } from './persist.ts';
import { writeCampaignSpend } from './writers/campaigns.ts';
import { writeSocialActivity } from './writers/social.ts';
import { writeSeoRows, writeWebVitals } from './writers/seo.ts';
import { writeWorkTasks } from './writers/tasks.ts';
import { linkConvertedLeads, writeCrmActivity, writeCrmRecords, writeRevenueFromWonDeals } from './writers/crm.ts';
import { writeOutreach } from './writers/outreach.ts';

// Everything that reads or writes integration state goes through here, so the rule
// "state is read from the row, never inferred" holds in one place.
//
// The domain materialisers — turning a provider's points into typed CRM, social, SEO,
// outreach, campaign and task rows — live in ./writers/, one file per domain, and the
// chunked-upsert plumbing they share lives in ./persist.ts. What stays here is
// integration lifecycle (connect/disconnect/setConfig/cards) and sync orchestration
// (claimSync/sync/runPaged/syncAll/syncStatus) — this file used to be all of it at once,
// 2,710 lines for four things that share almost no code with each other.

// splitName is genuinely part of the CRM writer (lib/integrations/writers/crm.ts), but
// stayed exported from here too: tools/providers.test.ts imported it from this path
// before the split, and there is no reason to make an unrelated test edit part of a
// file-move commit.
export { splitName } from './writers/crm.ts';

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
      // Non-null means a paged backfill has more to fetch. `state` cannot say so: it
      // returns to `connected` between slices, so a sync that spans a dozen slices looks
      // finished a dozen times over.
      syncCursor: true,
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
    // A backfill between slices: the lock is free, the cursor is not. Whoever is driving
    // it (the route's `after`, its chained continuation, or the nightly cron) is about to
    // take the lock again, so the truthful badge is "Syncing", not "Connected" — a card
    // reading Connected next to a half-imported CRM is how someone concludes the import
    // finished. Gone quiet for longer than a lease means nothing is driving it any more.
    if (state === 'connected' && row?.syncCursor != null) {
      state =
        Date.now() - row.updatedAt.getTime() > SYNC_LEASE_MS ? 'sync_paused' : 'syncing';
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

/**
 * The least a provider is worth starting with.
 *
 * `syncAll` hands each provider what is left of its own budget, and below this there is
 * not enough of it to fetch a page and write it. Starting one anyway spends the slice
 * being killed rather than importing anything, and the kill lands on the sync lock.
 */
const MIN_SLICE_MS = 20_000;

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
async function claimSync(integrationId: string, providerId: string, providerName: string): Promise<void> {
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

  // The lease this run just took may have been held by one the platform killed. That run
  // wrote no outcome — nothing survived to write one — so its sync_run row still says
  // `running`, and the history goes on reporting a sync in progress that ended hours ago.
  // Taking the lease is the moment that claim becomes provably false, so it is closed
  // here rather than left for a reader to infer.
  //
  // `durationMs` is deliberately left null: it is how a run the platform killed is told
  // apart from one that failed and lived long enough to say so.
  await db().syncRun.updateMany({
    where: {
      provider: providerId,
      status: 'running',
      startedAt: { lt: new Date(Date.now() - SYNC_LEASE_MS) },
    },
    data: {
      status: 'failed',
      complete: false,
      finishedAt: new Date(),
      error: 'Killed mid-run: the function ended before the sync did, so no error was recorded at the time.',
    },
  });
}

/**
 * Syncs one provider.
 *
 * `budgetMs` is how long a paged pull may spend fetching before it saves its place and
 * returns. A parameter rather than a constant because the answer depends on who is
 * calling: a provider on its own cron has the whole function to itself, while one sharing
 * the nightly run can only have what the providers before it left behind.
 */
export async function sync(
  id: string,
  days = 30,
  actorEmail: string | null = null,
  budgetMs: number = SYNC_BUDGET_MS,
) {
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

  await claimSync(integration.id, id, provider.name);

  // G5.1. Opened before the work starts and closed on both outcomes, so a run killed by
  // the platform mid-flight leaves a row saying 'running' with no finish — which is the
  // signature of a timeout and the one failure Integration's three columns could never
  // record, because nothing ever got as far as writing them.
  const run = await db().syncRun.create({
    data: { provider: id, status: 'running', actorEmail },
    select: { id: true, startedAt: true },
  });
  type RunClose = {
    status: 'succeeded' | 'failed';
    rows?: number;
    detail?: string;
    error?: string;
    complete: boolean;
  };
  const closeRun = (data: RunClose) =>
    db()
      .syncRun.update({
        where: { id: run.id },
        data: { ...data, finishedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() },
      })
      // A run row is a record of the sync, not part of it. Losing one must not turn a
      // successful import into a failed one, nor mask the real error behind a write
      // error about the audit trail.
      .catch((e: unknown) => {
        console.warn(`[integrations] could not close the run row for ${id}:`, e);
      });

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);

  try {
    let credential = open(integration.credential);
    credential = await renewIfNearExpiry(provider, integration.id, credential, integration.credential.expiresAt);

    const config = (integration.config as Record<string, unknown>) ?? {};

    const outcome = provider.syncPaged
      ? await runPaged(provider, integration, credential, config, { from, to }, budgetMs)
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

    await closeRun({
      status: 'succeeded',
      rows: outcome.rows,
      detail: outcome.detail,
      complete: outcome.done,
    });

    return outcome;
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : ((e as Error).message ?? 'Sync failed.');
    await db().integration.update({
      where: { id: integration.id },
      data: { state: 'error', lastError: message, lastErrorAt: new Date() },
    });
    await closeRun({ status: 'failed', error: message, complete: false });
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
  return { rows: totalRows(counts), detail: describe(counts), done: true };
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
  budgetMs: number,
): Promise<SyncResult> {
  const startedAt = new Date();
  const deadline = Date.now() + budgetMs;

  let cursor = (integration.syncCursor as SyncCursor | null) ?? null;

  // Mid-backfill, keep pulling everything: a watermark applied now would skip the records
  // the backfill has not reached yet. The watermark only takes effect on a fresh pass.
  const since = cursor ? null : integration.syncedThrough;

  const total = { rows: 0, vitalsRows: 0, workTaskRows: 0, campaignDays: 0, socialRows: 0, seoRows: 0, crmRows: 0, linkedRows: 0, activityRows: 0, revenueRows: 0, outreachRows: 0 };

  do {
    const slice = await provider.syncPaged!(credential, config, { cursor, since, deadline, range });
    const counts = await persist(provider, integration.id, config, slice.points);

    total.rows += counts.rows;
    total.vitalsRows += counts.vitalsRows;
    total.workTaskRows += counts.workTaskRows;
    total.campaignDays += counts.campaignDays;
    total.socialRows += counts.socialRows;
    total.seoRows += counts.seoRows;
    total.crmRows += counts.crmRows;
    total.outreachRows += counts.outreachRows;
    // Accumulated for the same reason as the eight above, and missed until `rows` began
    // counting them: a paged provider's activities, conversions and revenue were written
    // slice by slice and then reported as none, because only the last slice's numbers
    // reached the total — and `describe` omits a zero, so the detail line simply left
    // them out.
    total.linkedRows += counts.linkedRows;
    total.activityRows += counts.activityRows;
    total.revenueRows += counts.revenueRows;

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

  return { rows: totalRows(total), detail, done };
}

type Counts = {
  /** metric_snapshot rows only. Every other field below is a table of its own. */
  rows: number;
  vitalsRows: number;
  workTaskRows: number;
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
 * Every row a run wrote, across every table it writes to.
 *
 * What `lastSyncRows` and `SyncRun.rows` are for, and what they were not carrying:
 * `Counts.rows` is metric_snapshot alone, so a CRM sync that imported 43,750 leads,
 * contacts and deals recorded `0`, and the card read "0 rows" beside a run that had
 * worked perfectly. The detail string had it right all along — "Wrote 0 metric rows,
 * 43750 CRM records" — but the number beside the date is the one anybody reads, and it
 * was describing a healthy sync as an empty one. sync-health's `medianRows` was reading
 * the same column, and calling the same sync an import of nothing every night.
 *
 * A sum across tables rather than a count of distinct records, which is the honest
 * reading of "rows written": a point that becomes a Lead also becomes a metric row, and
 * both were written. `describe()` keeps the breakdown for anyone who wants it.
 */
function totalRows(c: Counts): number {
  return (
    c.rows +
    c.vitalsRows +
    c.workTaskRows +
    c.campaignDays +
    c.socialRows +
    c.seoRows +
    c.crmRows +
    c.linkedRows +
    c.activityRows +
    c.revenueRows +
    c.outreachRows
  );
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
    // After writeSeoRows, always: it updates the rows that step may have just created.
    vitalsRows: await writeWebVitals(points),
    workTaskRows: await writeWorkTasks(provider, points),
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
    c.vitalsRows ? `${c.vitalsRows} pages with speed findings` : null,
    c.workTaskRows ? `${c.workTaskRows} project tasks` : null,
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
 *
 * `deadline` is the caller's own ceiling, as an absolute instant, and is what keeps
 * sequential from meaning "until the platform intervenes". Without it every provider was
 * handed the full 230s budget inside one 300s function that had eleven of them to get
 * through, so the run did not finish — it was killed, mid-provider, with that provider
 * holding the sync lock and its run row left saying `running` for ever. Stopping early
 * costs nothing a resumable pull cannot recover: a provider that does not run tonight
 * keeps its cursor and goes first tomorrow.
 */
export async function syncAll(days = 30, deadline: number | null = null): Promise<SyncAllResult[]> {
  const rows = await db().integration.findMany({
    where: { credential: { isNot: null } },
    select: { provider: true, state: true },
    // Longest without a sync goes first. The order used to be whatever the table gave
    // back, which meant a run short of time skipped the same tail every night — and a
    // provider at the end of an unchanging list is a provider that never syncs again.
    // Nulls first: never synced is the longest wait there is.
    orderBy: [{ lastSyncAt: { sort: 'asc', nulls: 'first' } }],
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
    // Runs on its own cron because it is too slow to share this one. See ownSchedule.
    if (provider.ownSchedule) {
      results.push({ provider: row.provider, status: 'skipped', reason: 'Runs on its own schedule.' });
      continue;
    }

    // What is left of the caller's ceiling, shared out one provider at a time rather than
    // divided up front: a provider that finishes in four seconds should leave the rest of
    // its slice to whoever comes next, not have it written off in advance.
    let budgetMs = SYNC_BUDGET_MS;
    if (deadline !== null) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_SLICE_MS) {
        results.push({
          provider: row.provider,
          status: 'skipped',
          reason: 'Out of time in this run. It keeps its place and goes first on the next one.',
        });
        continue;
      }
      budgetMs = Math.min(SYNC_BUDGET_MS, remaining);
    }

    try {
      // One slice per provider per run. A backfill that needs longer keeps its cursor
      // and resumes on the next run, rather than one large provider starving the rest.
      const { rows: written, done } = await sync(row.provider, days, null, budgetMs);
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

/**
 * Live sync state, read straight from the database.
 *
 * Deliberately not wrapped in `cached()` like `cards()` is. The cards' 300-second TTL is
 * fine for "is this connected" and wrong for "is this syncing right now" — it is the
 * whole reason a sync that carried on after the tab was switched away came back showing
 * an idle button. This is what the page polls while a sync is running, so it must be
 * allowed to cost its round trip.
 */
export type SyncStatus = {
  provider: string;
  /** The same widened state `cards()` reports, derived the same way. */
  state: string;
  /** True while a sync is running or mid-backfill — what disables the button. */
  busy: boolean;
  /** The running provider's own progress line: "1,200 of 39,412 records". */
  detail: string | null;
  lastError: string | null;
  lastSyncAt: Date | null;
  lastSyncRows: number | null;
};

export async function syncStatus(): Promise<SyncStatus[]> {
  const rows = await db().integration.findMany({
    select: {
      provider: true,
      state: true,
      updatedAt: true,
      syncCursor: true,
      lastError: true,
      lastSyncAt: true,
      lastSyncRows: true,
    },
  });

  // One query for every provider's most recent run rather than one per provider. Only
  // runs young enough to still be relevant are considered, which the (startedAt) index
  // covers, and the newest per provider wins because the list arrives newest-first.
  const recent = await db().syncRun.findMany({
    where: { startedAt: { gt: new Date(Date.now() - SYNC_LEASE_MS) } },
    orderBy: { startedAt: 'desc' },
    select: { provider: true, detail: true },
  });
  const detailByProvider = new Map<string, string | null>();
  for (const r of recent) {
    if (!detailByProvider.has(r.provider)) detailByProvider.set(r.provider, r.detail);
  }

  return rows.map((row) => {
    const stale = Date.now() - row.updatedAt.getTime() > SYNC_LEASE_MS;
    let state: string = row.state;
    if (state === 'syncing' && stale) state = 'sync_stalled';
    else if (state === 'connected' && row.syncCursor != null) {
      state = stale ? 'sync_paused' : 'syncing';
    }
    return {
      provider: row.provider,
      state,
      busy: state === 'syncing',
      detail: detailByProvider.get(row.provider) ?? null,
      lastError: row.lastError,
      lastSyncAt: row.lastSyncAt,
      lastSyncRows: row.lastSyncRows,
    };
  });
}
