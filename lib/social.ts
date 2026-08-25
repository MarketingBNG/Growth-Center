import { db } from './prisma.ts';
import { rate } from './calc.ts';

export async function socialOverview() {
  const accounts = await db().socialAccount.findMany({
    orderBy: { followers: 'desc' },
    include: { posts: { orderBy: { publishedAt: 'desc' } } },
  });

  const rows = accounts.map((a) => {
    const reach = a.posts.reduce((t, p) => t + p.reach, 0);
    const impressions = a.posts.reduce((t, p) => t + p.impressions, 0);
    const engagements = a.posts.reduce((t, p) => t + p.likes + p.comments + p.shares, 0);
    const clicks = a.posts.reduce((t, p) => t + p.clicks, 0);
    return {
      id: a.id,
      network: a.network,
      handle: a.handle,
      name: a.name,
      followers: a.followers,
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
      engagements: p.likes + p.comments + p.shares,
      clicks: p.clicks,
      engagementRate: rate(p.likes + p.comments + p.shares, p.reach),
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
  };
}
