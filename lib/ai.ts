import OpenAI from 'openai';
import { z } from 'zod';
import { db } from './prisma.ts';
import { AI_KEY_ENV, INSIGHT_KINDS } from './enums.ts';
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
    // Named at this length because the short name was actively misleading, and the model
    // said so: it reported "a data inconsistency" between `current.qualifiedLeads` (80) and
    // `leadsByStatus.qualified` (3) and withheld a real finding over it.
    //
    // There is no inconsistency. They count different things twice over — this is every
    // lead ever, by the status it sits in right now; that one is leads created in the window
    // that ever reached qualified. And `qualified` is a state leads pass through: 1,031 have
    // reached it, 1,028 went on to `converted`, which leaves the 3 standing there today.
    allLeadsByCurrentStatus: Object.fromEntries(statuses.map((s) => [s.status, s._count._all])),
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

About the two lead counts, which are NOT comparable:
- \`current.*\` covers only the last \`periodDays\` days.
  \`allLeadsByCurrentStatus\` covers every lead ever recorded, with no window.
- \`current.qualifiedLeads\` counts leads that ever reached qualified.
  \`allLeadsByCurrentStatus.qualified\` counts leads sitting in that status today, which is
  a state leads pass through on their way to \`converted\` — a small number there is normal
  and is not evidence of anything.
- So never divide one by the other, and never report a gap between them as an
  inconsistency in the data.

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

  // Named for what it counts. It was `unassigned`, which it never was — these are leads in
  // status `new`, whether or not anybody owns them, and almost all of them do.
  const untouched = ctx.allLeadsByCurrentStatus.new ?? 0;
  if (untouched > 0) {
    findings.push({
      kind: 'recommendation',
      title: `${untouched.toLocaleString('en-US')} leads are still in "new"`,
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

// ── generated insights ────────────────────────────────────────────────────────
//
// The findings the AI Insights page shows without being asked a question. Until this
// existed the page had two arithmetic sentences and a panel reading "None saved", because
// nothing in the app ever wrote to ai_insight except the seed.
//
// Manual on purpose for now: a button someone presses, not a step in the nightly sync.

/**
 * Structured output, not prose parsed with a regular expression.
 *
 * `strict` holds the model to this exactly, which is what lets the rows be written straight
 * to a typed enum column. The alternative — asking for JSON in the prompt and hoping —
 * fails on the day the model wraps it in a code fence, and fails by writing nothing while
 * reporting success.
 */
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'body', 'confidence'],
        properties: {
          kind: { type: 'string', enum: [...INSIGHT_KINDS] },
          title: { type: 'string' },
          body: { type: 'string' },
          confidence: { type: 'integer' },
        },
      },
    },
  },
} as const;

/** Validated rather than trusted. `strict` is the vendor's promise, and a row that reaches
 *  a Prisma enum column has to satisfy this side of the boundary too. */
const findingsShape = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(INSIGHT_KINDS),
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(2000),
        confidence: z.number().int().min(0).max(100),
      }),
    )
    .max(12),
});

const INSIGHTS_SYSTEM = `${SYSTEM}

You are now writing standalone findings rather than answering a question. Return between
three and six, ordered with the most consequential first.

- Every finding must name the figures it rests on, and those figures must be in the data.
- \`title\` is one line a busy person can act on. No preamble, under 90 characters.
- \`body\` is two or three sentences: what the numbers say, and what follows from it.
- \`confidence\` is 0-100 and reflects how well the data supports the claim, not how
  strongly you feel. A finding resting on a null or a single record does not deserve 90.
- Prefer fewer, better findings. Three real ones beat six padded to fill the quota.
- Do not repeat a finding the arithmetic already states plainly, such as the raw count of
  leads in "new" or the size of the open pipeline.
- \`leadOwners\` entries are colleagues, and these findings are read by their team. Refer to
  a person by name, or as "they". Never infer anyone's gender from their name — the data
  does not record it, and guessing it wrong about a named coworker is worse than the plain
  alternative.
- Write figures the way a reader can take them in: thousands separated, so 1,295,976 rather
  than 1295976.
- A \`confidence\` above 90 says the data settles the point on its own. If your own \`body\`
  admits the snapshot cannot explain something, or rests the claim on a single record or a
  null, the figure belongs well below that.`;

// A note on that last rule: it does not work. Measured over several runs, every finding
// comes back between 95 and 99 — including ones whose own body says the snapshot cannot
// explain what they describe. Self-reported confidence from this model is not calibrated,
// and asking more firmly does not calibrate it.
//
// The rule stays because it is correct guidance and costs forty tokens. The column stays
// because it records what the model claimed. But nothing renders it, and nothing should
// start rendering it as though it ranked anything — sorting this page by `confidence` would
// be sorting by noise.

export type GeneratedInsights = {
  written: number;
  usage?: TokenUsage;
  model: string;
};

/**
 * Asks the model for findings and replaces the previously generated set.
 *
 * Replaces rather than appends: a finding describes the numbers as they were when it was
 * written, so keeping last month's beside this month's presents stale claims as current.
 * Seeded rows are left alone — they are labelled samples and not ours to delete.
 *
 * A dismissal does not survive a regeneration, which is the honest behaviour: the set was
 * thrown away and rebuilt, so there is nothing left for the dismissal to apply to.
 */
export async function generateInsights(context: GrowthContext): Promise<GeneratedInsights> {
  const status = aiStatus();
  if (!status.configured) throw new Error(status.reason);

  const client = new OpenAI({ apiKey: process.env[AI_KEY_ENV] });

  const response = await client.responses.create({
    model: MODEL,
    instructions: INSIGHTS_SYSTEM,
    input: `Growth data:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: EFFORT },
    text: {
      format: {
        type: 'json_schema',
        name: 'growth_findings',
        schema: FINDINGS_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    },
    store: false,
  });

  const raw = response.output_text.trim();
  if (!raw) {
    throw new Error(
      response.incomplete_details?.reason === 'max_output_tokens'
        ? 'The model used its entire output budget before writing any findings.'
        : 'The model returned no findings.',
    );
  }

  let parsed: z.infer<typeof findingsShape>;
  try {
    parsed = findingsShape.parse(JSON.parse(raw));
  } catch (e) {
    // The raw text is deliberately not written anywhere a page will render it — a
    // half-formed finding shown as analysis is the one outcome this module exists to
    // prevent.
    throw new Error(`The model's findings did not match the expected shape: ${(e as Error).message}`);
  }

  const usage = response.usage
    ? {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.total_tokens,
      }
    : undefined;

  if (!parsed.findings.length) return { written: 0, usage, model: MODEL };

  // One transaction, so a failure cannot leave the page with the old set deleted and the
  // new one unwritten — which would read as "the AI found nothing".
  await db().$transaction([
    db().aiInsight.deleteMany({ where: { provider: { not: 'seed' } } }),
    db().aiInsight.createMany({
      data: parsed.findings.map((f) => ({
        kind: f.kind,
        title: f.title,
        body: f.body,
        provider: 'openai',
        model: MODEL,
        confidence: f.confidence,
        context: { periodDays: context.periodDays },
      })),
    }),
  ]);

  return { written: parsed.findings.length, usage, model: MODEL };
}
