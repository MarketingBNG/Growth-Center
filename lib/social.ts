import { db } from './prisma.ts';
import { rate } from './calc.ts';

/**
 * Every deliberate action on a post, whichever network reported it.
 *
 * Facebook reports shares and no saves; Instagram reports saves and no shares. Counting
 * both keeps the two networks' engagement rates comparable — which they were not while
 * Instagram's saves were arriving in the `shares` column.
 */
function engagementsOf(p: { likes: number; comments: number; shares: number; saves: number }) {
  return p.likes + p.comments + p.shares + p.saves;
}

/** Posts listed under the accounts. Twelve is what the page renders. */
const RECENT_POSTS = 12;

export async function socialOverview() {
  // Totals from the database, and only the posts the page actually lists. Including
  // every post to add them up loaded an account's whole history on each view — fine at
  // zero posts, and the same shape of mistake that pulled 23,687 prospects into the
  // Outreach page.
  const [accounts, totalsByAccount, latest] = await Promise.all([
    db().socialAccount.findMany({ orderBy: { followers: 'desc' } }),
    db().socialPost.groupBy({
      by: ['accountId'],
      _count: { _all: true },
      _sum: { reach: true, impressions: true, clicks: true, likes: true, comments: true, shares: true, saves: true },
    }),
    db().socialPost.findMany({ orderBy: { publishedAt: 'desc' }, take: RECENT_POSTS }),
  ]);

  const sums = new Map(totalsByAccount.map((t) => [t.accountId, t]));

  // Whether an account's figures are arriving from a live connection. The schema keeps
  // `integrationId` for exactly this, but a stored id is not enough — an integration can
  // be disconnected or erroring after the fact, and the numbers left behind are then no
  // more current than the seeded ones. So the state is read, never assumed.
  const linkedIds = [...new Set(accounts.map((a) => a.integrationId).filter((id) => id !== null))];
  const linked = linkedIds.length
    ? await db().integration.findMany({
        where: { id: { in: linkedIds } },
        select: { id: true, state: true },
      })
    : [];
  const liveIds = new Set(
    linked.filter((i) => i.state === 'connected' || i.state === 'syncing').map((i) => i.id),
  );
  const isLive = (integrationId: string | null) => integrationId !== null && liveIds.has(integrationId);

  const rows = accounts.map((a) => {
    const t = sums.get(a.id);
    const sum = t?._sum;
    const n = (v: number | null | undefined) => v ?? 0;
    const reach = n(sum?.reach);
    const impressions = n(sum?.impressions);
    const engagements = n(sum?.likes) + n(sum?.comments) + n(sum?.shares) + n(sum?.saves);
    const clicks = n(sum?.clicks);
    return {
      id: a.id,
      network: a.network,
      handle: a.handle,
      name: a.name,
      followers: a.followers,
      live: isLive(a.integrationId),
      posts: t?._count._all ?? 0,
      reach,
      impressions,
      engagements,
      clicks,
      // Against reach, not followers: reach is who actually saw it.
      engagementRate: rate(engagements, reach),
      clickRate: rate(clicks, reach),
    };
  });

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const recent = latest
    .map((p) => ({ post: p, account: accountById.get(p.accountId) }))
    .filter((r): r is { post: (typeof latest)[number]; account: NonNullable<typeof r.account> } => !!r.account)
    .map(({ post: p, account }) => ({
      id: p.id,
      network: account.network,
      handle: account.handle,
      publishedAt: p.publishedAt,
      caption: p.caption,
      permalink: p.permalink,
      reach: p.reach,
      engagements: engagementsOf(p),
      clicks: p.clicks,
      engagementRate: rate(engagementsOf(p), p.reach),
    }));

  const totals = rows.reduce(
    (acc, r) => ({
      followers: acc.followers + r.followers,
      posts: acc.posts + r.posts,
      reach: acc.reach + r.reach,
      engagements: acc.engagements + r.engagements,
      clicks: acc.clicks + r.clicks,
    }),
    { followers: 0, posts: 0, reach: 0, engagements: 0, clicks: 0 },
  );

  // What the integrations SAY they are reporting, whether or not an account row exists
  // for it.
  //
  // Read so an empty page can tell the two cases apart. With no accounts written, the page
  // said "No social accounts. Connect Facebook and Instagram on the Integrations page" —
  // advice for someone who has not connected anything, shown to a workspace whose Meta
  // connection was syncing a follower count every day. The accounts had been deleted by a
  // prune bug in writeSocialActivity; the page had no way to say so and blamed the reader.
  const reportedAccounts = rows.length
    ? []
    : (
        await db().metricSnapshot.groupBy({
          by: ['entityId'],
          where: { entityType: 'social_account' },
          _max: { date: true },
        })
      )
        .filter((r) => r.entityId)
        .map((r) => ({ entityId: r.entityId as string, lastSeen: r._max.date }));

  return {
    accounts: rows,
    /** Accounts an integration has reported into the metrics layer but which have no
     *  SocialAccount row. Only populated when the page would otherwise be empty. */
    reportedAccounts,
    recent,
    totals: { ...totals, engagementRate: rate(totals.engagements, totals.reach) },
    /** Networks whose figures are still seeded. Empty means the page can drop its warning.
     *  De-duplicated: a workspace can hold two accounts on one network, and the warning
     *  named it twice. */
    seededNetworks: [...new Set(rows.filter((r) => !r.live).map((r) => r.network))],
  };
}
