import OpenAI from 'openai';
import { db } from './prisma.ts';
import { AI_KEY_ENV } from './enums.ts';
import { channelPerformance, funnel, openPipeline, rangeFor } from './metrics.ts';
import { campaignPerformance } from './campaigns.ts';
import { num } from './calc.ts';
import { ownerWorkload } from './allocation.ts';
import { symbolOf } from './currency.ts';

// AI insights over Growth Center's own data.
//
// The hard rule: this module never invents a finding. If no key is configured it returns
// `configured: false` and the UI says so — it does not fall back to a canned answer
// dressed as analysis. Seeded example insights are stored with provider 'seed' and are
// labelled as samples wherever they appear.

export type AiStatus =
  | { configured: false; reason: string }
  | { configured: true; provider: string; model: string };

// The cheap end of the gpt-5.6 family: $0.20 per million in, $1.20 out — a tenth of
// `gpt-5.6-terra`, which this ran on first, and which is the step up if answers start
// disappointing.
//
// Affordable partly because the job is small. The model is handed a ~3,700-token snapshot
// and asked to read figures out of it under a prompt that forbids inventing any; it is not
// being asked to reason its way to something new. At this price a question costs about a
// tenth of a penny, which is what makes the page worth leaving switched on.
const MODEL = 'gpt-5.6-luna';

// The Responses API, not chat completions: it is the surface OpenAI recommends for the
// gpt-5 family, and the only one carrying `reasoning` and the incomplete-response details
// that `ask()` needs to tell a cut-off answer from a finished one.
//
// Low on both knobs deliberately. This is a short factual read over a ~3,000-token
// snapshot, and reasoning tokens are billed as output — at $12 per million, thinking hard
// about a table of figures costs more than the answer is worth. The system prompt already
// asks for short answers; `verbosity` enforces it without spending tokens saying so.
const EFFORT = 'low' as const;
const VERBOSITY = 'low' as const;

// 900 truncated real answers mid-sentence and the truncation was invisible — the cut-off
// text was returned as if complete. Room to finish, and the cut is reported if it still
// happens. Note this budget covers reasoning AND visible text on this model family, which
// is why ask() has to handle a response that spent all of it before writing anything.
const MAX_OUTPUT_TOKENS = 16000;

export function aiStatus(): AiStatus {
  if (!process.env[AI_KEY_ENV]) {
    return {
      configured: false,
      reason: `${AI_KEY_ENV} is not set, so no analysis can run.`,
    };
  }
  return { configured: true, provider: 'openai', model: MODEL };
}

/**
 * The numbers an answer may be based on.
 *
 * Assembled server-side and passed to the model as data. The model is told to answer
 * only from this — it has no database access and cannot go looking for more.
 */
export async function growthContext(days = 90) {
  const { current, previous } = rangeFor(days);
  const [now, before, channels, campaigns, pipeline, statuses, workload] = await Promise.all([
    funnel(current),
    funnel(previous),
    channelPerformance(current),
    campaignPerformance(current),
    openPipeline(),
    db().lead.groupBy({ by: ['status'], _count: { _all: true } }),
    ownerWorkload(),
  ]);

  return {
    periodDays: days,
    // Every money figure below is in this currency. Without it the model reads bare
    // numbers and assumes dollars, which is wrong by roughly ninety-five times here —
    // and it would say so with complete confidence.
    currency: now.currency,
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
    // Who is carrying what. Absent until now, which meant the honest answer to "who has
    // too many leads" was that the data could not say — the one question the team asked of
    // this page that it had no figures for.
    //
    // All four counts per person, never just `open`, because `open` on its own is wrong in
    // a specific and confident way: see the note on OwnerWorkload.notReachable.
    leadOwners: workload,
    openPipeline: { deals: pipeline.count, value: Math.round(pipeline.total), weighted: Math.round(pipeline.weighted) },
    channels: channels.map((c) => ({
      name: c.name,
      kind: c.kind,
      spend: Math.round(c.spend),
      leads: c.leads,
      customers: c.customers,
      revenue: c.revenue === null ? null : Math.round(c.revenue),
      cac: c.cac === null ? null : Math.round(c.cac),
      roas: c.roas === null ? null : Number(c.roas.toFixed(2)),
    })),
    campaigns: campaigns
      .filter((c) => c.spend > 0 || (c.leads ?? 0) > 0)
      .map((c) => ({
        name: c.name,
        channel: c.channelName,
        spend: Math.round(c.spend),
        // Null where nothing attributes the figure to a campaign. Sent as 0 the model
        // reads it as a campaign that produced nothing and writes that up as a finding.
        leads: c.leads,
        customers: c.customers,
        revenue: c.revenue === null ? null : Math.round(c.revenue),
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
- Every money figure is in the currency named by the snapshot's \`currency\` field. Use
  that currency when you quote one, and never convert it.
- Be specific and short. Name the channel or campaign and the figure that supports the point.
- Do not recommend anything the data does not support.

About \`leadOwners\`:
- \`open\` is not a workload. It counts every lead still open, and most of this firm's are
  \`notReachable\` — calls that did not connect — or have never been worked at all. Never
  call somebody overloaded on \`open\` alone; say which of the four figures you mean.
- \`untouched\` is the CRM's own "Untouched Lead" status: arrived, nobody has worked it.
  It is the only figure that represents leads waiting to be picked up.
- \`active\` is open leads with a call or meeting logged in the last 30 days. It is the
  closest thing here to what someone is really working.
- Leads are shared out on \`untouched\` only, by the Rebalance action on the Leads page.
  If asked to redistribute leads, say that is what does it — do not invent an allocation
  of your own, and do not imply you have moved anything.`;

export type TokenUsage = { input: number; output: number; total: number };

export type AnswerResult =
  | { ok: true; answer: string; model: string; truncated?: boolean; usage?: TokenUsage }
  | { ok: false; error: string };

export async function ask(question: string, context: GrowthContext): Promise<AnswerResult> {
  const status = aiStatus();
  if (!status.configured) return { ok: false, error: status.reason };

  const client = new OpenAI({ apiKey: process.env[AI_KEY_ENV] });

  try {
    const response = await client.responses.create({
      model: MODEL,
      // The rules go in `instructions` rather than the input, which is what keeps them
      // separable from the data: the snapshot below is untrusted in the sense that matters
      // here — it is full of free-text the CRM collected from strangers.
      instructions: SYSTEM,
      input: `Growth data:
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Question: ${question}`,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: EFFORT },
      text: { verbosity: VERBOSITY },
      // Nothing here should outlive the request. The snapshot carries named leads, owner
      // addresses and revenue, and there is no reason for a copy of it to sit in a vendor
      // dashboard once the question is answered.
      store: false,
    });

    const answer = response.output_text.trim();
    const usage = response.usage
      ? {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          total: response.usage.total_tokens,
        }
      : undefined;

    const cutOff =
      response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens';

    // A reasoning model can spend the whole output budget thinking and return no text at
    // all — billed in full, and `output_text` an empty string. Reported as the failure it
    // is: the alternative renders an empty answer card under a question the person asked
    // and paid for, with nothing saying why.
    if (!answer) {
      return {
        ok: false,
        error: cutOff
          ? 'The model used its entire output budget before writing an answer. Ask a narrower question, or raise MAX_OUTPUT_TOKENS.'
          : 'The model returned no text.',
      };
    }

    // A truncated answer must never be presented as a finished one.
    if (cutOff) return { ok: true, answer, model: MODEL, truncated: true as const, usage };

    return { ok: true, answer, model: MODEL, usage };
  } catch (e) {
    // Surfaced to the user as-is rather than swallowed — a failed call must not look
    // like an answer. The vendor's own message is the useful part: it is what says
    // "insufficient quota" or "invalid api key", which is what the reader has to act on.
    if (e instanceof OpenAI.APIError) {
      return { ok: false, error: `OpenAI ${e.status ?? ''}: ${e.message}`.replace('  ', ' ') };
    }
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

  // Every figure below is already in ctx.currency — growthContext converted it and says so
  // for exactly this reason. These sentences then printed a dollar sign onto it anyway, so
  // a workspace reporting in rupees read "Meta Ads has spent $406,737": the right number
  // with a symbol that overstates it by ninety-five times, in text a person is meant to
  // act on. The model's own answers were never wrong about this; only the rule findings,
  // which are the ones shown before any key is configured.
  const money = (n: number) => `${symbolOf(ctx.currency)}${n.toLocaleString('en-US')}`;

  const paid = ctx.channels.filter((c) => c.spend > 0 && c.roas !== null);
  if (paid.length >= 2) {
    const sorted = [...paid].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    // A non-null ROAS means revenue is attributed to the campaign, so both figures below
    // are known — narrowed here rather than defaulted at the call sites, which would put a
    // confident 0 into a sentence the model then reports as fact.
    if (
      best.roas &&
      worst.roas !== null &&
      best.roas > worst.roas &&
      best.revenue !== null &&
      worst.revenue !== null
    ) {
      findings.push({
        kind: 'opportunity',
        title: `${best.name} returns ${best.roas}× against ${worst.name}'s ${worst.roas}×`,
        body: `Over the last ${ctx.periodDays} days ${best.name} took ${money(best.spend)} and returned ${money(best.revenue)}. ${worst.name} took ${money(worst.spend)} and returned ${money(worst.revenue)}.`,
      });
    }
  }

  // TODO: 1000 is a currency-blind floor, written when every figure here was assumed to be
  // dollars. Against a workspace reporting in rupees it is about $10, so it no longer
  // excludes the trivial spend it was meant to. Left as it stands rather than rescaled on
  // a guess — what counts as spend worth flagging is the account's call, not this file's.
  const noReturn = ctx.channels.filter((c) => c.spend > 1000 && c.revenue === 0);
  for (const c of noReturn) {
    findings.push({
      kind: 'risk',
      title: `${c.name} has spent ${money(c.spend)} with no attributed revenue`,
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
      body: `${ctx.current.leads} leads against ${ctx.previousPeriod.leads}, while spend moved from ${money(ctx.previousPeriod.marketingSpend)} to ${money(ctx.current.marketingSpend)}.`,
    });
  }

  if (ctx.openPipeline.deals > 0) {
    findings.push({
      kind: 'opportunity',
      title: `${money(ctx.openPipeline.weighted)} of weighted pipeline is open`,
      body: `${ctx.openPipeline.deals} deals worth ${money(ctx.openPipeline.value)} at face value, ${money(ctx.openPipeline.weighted)} weighted by each deal's own probability.`,
    });
  }

  return findings;
}

export const asNumber = num;
