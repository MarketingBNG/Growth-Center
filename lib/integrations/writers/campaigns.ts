import { db } from '../../platform/prisma.ts';
import type { IntegrationProvider, MetricPoint } from '../types.ts';
import { meta, str, WRITE_CHUNK } from '../persist.ts';

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
export async function writeCampaignSpend(
  provider: IntegrationProvider,
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
    if (m.status || m.startDate || m.endDate || m.budget != null || m.objective) {
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
          // G4. Written on every sync rather than only on create, so a campaign
          // re-categorised as employment at the platform stops counting against
          // acquisition on the next run instead of at the next backfill.
          objective: str(d.objective) ?? undefined,
          platformObjective: str(d.platformObjective) ?? undefined,
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
