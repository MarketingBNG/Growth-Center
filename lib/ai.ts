import Anthropic from '@anthropic-ai/sdk';
import { db } from './prisma.ts';
import { channelPerformance, funnel, openPipeline, rangeFor } from './metrics.ts';
import { campaignPerformance } from './campaigns.ts';
import { num } from './calc.ts';

// AI insights over Growth Center's own data.
//
// The hard rule: this module never invents a finding. If no key is configured it returns
// `configured: false` and the UI says so — it does not fall back to a canned answer
// dressed as analysis. Seeded example insights are stored with provider 'seed' and are
// labelled as samples wherever they appear.

export type AiStatus =
  | { configured: false; reason: string }
  | { configured: true; provider: string; model: string };

// Sonnet tier, current id. claude-sonnet-4-5 was a dated snapshot; claude-sonnet-5 is
// the current Sonnet and is cheaper per token than the 4-6 generation.
const MODEL = 'claude-sonnet-5';

// 900 truncated real answers mid-sentence and the truncation was invisible — the cut-off
// text was returned as if complete. Room to finish, and the cut is reported if it still
// happens. Non-streaming, so kept below the SDK's HTTP timeout rather than maxed out.
const MAX_TOKENS = 16000;

export function aiStatus(): AiStatus {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      configured: false,
      reason: 'ANTHROPIC_API_KEY is not set, so no analysis can run.',
    };
  }
  return { configured: true, provider: 'anthropic', model: MODEL };
}

/**
 * The numbers an answer may be based on.
 *
 * Assembled server-side and passed to the model as data. The model is told to answer
 * only from this — it has no database access and cannot go looking for more.
 */
export async function growthContext(days = 90) {
  const { current, previous } = rangeFor(days);
  const [now, before, channels, campaigns, pipeline, statuses] = await Promise.all([
    funnel(current),
    funnel(previous),
    channelPerformance(current),
    campaignPerformance(current),
    openPipeline(),
    db().lead.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  return {
    periodDays: days,
    current: {
      visitors: now.visitors,
      leads: now.leads,
      qualifiedLeads: now.qualified,
      opportunities: now.opportunities,
      newCustomers: now.customers,
      revenue: Math.round(now.revenue),
      marketingSpend: Math.round(now.spend),
      cac: now.cac === null ? null : Math.round(now.cac),
      roas: now.roas === null ? null : Number(now.roas.toFixed(2)),
      visitorToLeadPercent: now.visitorToLead === null ? null : Number(now.visitorToLead.toFixed(2)),
    },
    previousPeriod: {
      leads: before.leads,
      qualifiedLeads: before.qualified,
      newCustomers: before.customers,
      revenue: Math.round(before.revenue),
      marketingSpend: Math.round(before.spend),
    },
    leadsByStatus: Object.fromEntries(statuses.map((s) => [s.status, s._count._all])),
    openPipeline: { deals: pipeline.count, value: Math.round(pipeline.total), weighted: Math.round(pipeline.weighted) },
    channels: channels.map((c) => ({
      name: c.name,
      kind: c.kind,
      spend: Math.round(c.spend),
      leads: c.leads,
      customers: c.customers,
      revenue: Math.round(c.revenue),
      cac: c.cac === null ? null : Math.round(c.cac),
      roas: c.roas === null ? null : Number(c.roas.toFixed(2)),
    })),
    campaigns: campaigns
      .filter((c) => c.spend > 0 || c.leads > 0)
      .map((c) => ({
        name: c.name,
        channel: c.channelName,
        spend: Math.round(c.spend),
        leads: c.leads,
        customers: c.customers,
        revenue: Math.round(c.revenue),
        costPerLead: c.costPerLead === null ? null : Math.round(c.costPerLead),
        roas: c.roas === null ? null : Number(c.roas.toFixed(2)),
      })),
  };
}

export type GrowthContext = Awaited<ReturnType<typeof growthContext>>;

const SYSTEM = `You are a growth analyst for BNG Advisors, a CFO-services firm.

You will be given a JSON snapshot of the firm's own growth data. Answer ONLY from that
snapshot.

Rules:
- Never invent a number. Every figure you cite must appear in the data given to you.
- If the data cannot answer the question, say exactly what is missing instead of guessing.
- Where a metric is null it means "not computable" (usually no denominator), not zero.
- Be specific and short. Name the channel or campaign and the figure that supports the point.
- Do not recommend anything the data does not support.`;

export type AnswerResult =
  | { ok: true; answer: string; model: string; truncated?: boolean }
  | { ok: false; error: string };

export async function ask(question: string, context: GrowthContext): Promise<AnswerResult> {
  const status = aiStatus();
  if (!status.configured) return { ok: false, error: status.reason };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Growth data:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nQuestion: ${question}`,
        },
      ],
    });

    const answer = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!answer) return { ok: false, error: 'The model returned no text.' };

    // A truncated answer must never be presented as a finished one.
    if (message.stop_reason === 'max_tokens') {
      return {
        ok: true,
        answer,
        model: MODEL,
        truncated: true as const,
      };
    }

    return { ok: true, answer, model: MODEL };
  } catch (e) {
    // Surfaced to the user as-is rather than swallowed — a failed call must not look
    // like an answer.
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Deterministic, arithmetic-only observations. Not AI — these are computed, which is why
 * they are stored and displayed as 'rules' rather than as model output.
 *
 * Exists so the AI Insights page is useful before any key is configured, without
 * pretending a model produced it.
 */
export function ruleFindings(ctx: GrowthContext) {
  const findings: { kind: 'opportunity' | 'risk' | 'anomaly' | 'recommendation'; title: string; body: string }[] = [];

  const paid = ctx.channels.filter((c) => c.spend > 0 && c.roas !== null);
  if (paid.length >= 2) {
    const sorted = [...paid].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best.roas && worst.roas !== null && best.roas > worst.roas) {
      findings.push({
        kind: 'opportunity',
        title: `${best.name} returns ${best.roas}× against ${worst.name}'s ${worst.roas}×`,
        body: `Over the last ${ctx.periodDays} days ${best.name} took $${best.spend.toLocaleString('en-US')} and returned $${best.revenue.toLocaleString('en-US')}. ${worst.name} took $${worst.spend.toLocaleString('en-US')} and returned $${worst.revenue.toLocaleString('en-US')}.`,
      });
    }
  }

  const noReturn = ctx.channels.filter((c) => c.spend > 1000 && c.revenue === 0);
  for (const c of noReturn) {
    findings.push({
      kind: 'risk',
      title: `${c.name} has spent $${c.spend.toLocaleString('en-US')} with no attributed revenue`,
      body: `${c.leads} leads arrived from ${c.name} in this period and none have produced revenue yet. That may be a genuine loss or simply a longer sales cycle — the deals it produced are visible on the pipeline board.`,
    });
  }

  const unassigned = ctx.leadsByStatus.new ?? 0;
  if (unassigned > 0) {
    findings.push({
      kind: 'recommendation',
      title: `${unassigned} leads are still in "new"`,
      body: 'These have arrived and not yet been contacted. They are the cheapest pipeline available, because the acquisition cost is already spent.',
    });
  }

  const leadDelta = ctx.previousPeriod.leads
    ? ((ctx.current.leads - ctx.previousPeriod.leads) / ctx.previousPeriod.leads) * 100
    : null;
  if (leadDelta !== null && leadDelta < -10) {
    findings.push({
      kind: 'anomaly',
      title: `Lead volume is down ${Math.abs(leadDelta).toFixed(0)}% on the previous period`,
      body: `${ctx.current.leads} leads against ${ctx.previousPeriod.leads}, while spend moved from $${ctx.previousPeriod.marketingSpend.toLocaleString('en-US')} to $${ctx.current.marketingSpend.toLocaleString('en-US')}.`,
    });
  }

  if (ctx.openPipeline.deals > 0) {
    findings.push({
      kind: 'opportunity',
      title: `$${ctx.openPipeline.weighted.toLocaleString('en-US')} of weighted pipeline is open`,
      body: `${ctx.openPipeline.deals} deals worth $${ctx.openPipeline.value.toLocaleString('en-US')} at face value, $${ctx.openPipeline.weighted.toLocaleString('en-US')} weighted by each deal's own probability.`,
    });
  }

  return findings;
}

export const asNumber = num;
