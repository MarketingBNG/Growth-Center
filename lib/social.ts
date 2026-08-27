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

export async function socialOverview() {
  const accounts = await db().socialAccount.findMany({
    orderBy: { followers: 'desc' },
    include: { posts: { orderBy: { publishedAt: 'desc' } } },
  });

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
    const reach = a.posts.reduce((t, p) => t + p.reach, 0);
    const impressions = a.posts.reduce((t, p) => t + p.impressions, 0);
    const engagements = a.posts.reduce((t, p) => t + engagementsOf(p), 0);
    const clicks = a.posts.reduce((t, p) => t + p.clicks, 0);
    return {
      id: a.id,
      network: a.network,
      handle: a.handle,
      name: a.name,
      followers: a.followers,
      live: isLive(a.integrationId),
      posts: a.posts.length,
      reach,
      impressions,
      engagements,
      clicks,
      // Against reach, not followers: reach is who actually saw it.
      engagementRate: rate(engagements, reach),
      clickRate: rate(clicks, reach),
    };
  });

  const recent = accounts
    .flatMap((a) => a.posts.map((p) => ({ ...p, network: a.network, handle: a.handle })))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      network: p.network,
      handle: p.handle,
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

  return {
    accounts: rows,
    recent,
    totals: { ...totals, engagementRate: rate(totals.engagements, totals.reach) },
    /** Networks whose figures are still seeded. Empty means the page can drop its warning. */
    seededNetworks: rows.filter((r) => !r.live).map((r) => r.network),
  };
}
