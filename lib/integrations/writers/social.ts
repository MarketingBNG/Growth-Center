import { db } from '../../platform/prisma.ts';
import type { MetricPoint } from '../types.ts';

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
export async function writeSocialActivity(
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
