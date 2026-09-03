// Read-only database access for the AI.
//
// Three operations over an allowlist of tables, and nothing else. There is deliberately no
// SQL tool: the model cannot compose a statement here, only name a table and hand over a
// filter that Prisma validates against the real schema. That removes injection as a
// category rather than defending against it, and it makes "read-only" a property of what
// exists in this file rather than a promise about intent.
//
// The two tables holding secrets are absent from the allowlist, so no filter can reach
// them. Everything else in the schema is readable.
//
// Row caps matter as much as the allowlist. Without them one question could pull 27,000
// leads through the model's context, which would be slow, expensive, and would not answer
// the question any better than fifty rows and a count.

import { prisma } from './prisma.ts';

/** Hard ceiling on rows from one call, whatever the model asks for. */
export const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

/** How many times the model may call a tool before answering. Stops a loop that keeps
 *  refining a query from running up a bill with nothing to show. */
export const MAX_TOOL_ROUNDS = 6;

/**
 * Tables the model may read, and what each one is for.
 *
 * `integrationCredential` and `apiKey` are deliberately missing. The first holds sealed
 * OAuth refresh tokens for Zoho, Meta and Google; the second holds hashed API keys. Their
 * absence here is the whole of their protection, which is why this is an allowlist and not
 * a denylist — a table added to the schema later is unreadable until somebody puts it in
 * this object on purpose.
 */
export const TABLES: Record<string, string> = {
  lead: 'Every enquiry. `status` is the shared vocabulary; `sourceStatus` is Zoho\'s own wording, which is what the team works to.',
  contact: 'People at customer companies, converted from leads or synced from the CRM.',
  company: 'Companies. `nameKey` is the deduplicated name.',
  opportunity: 'Deals. Joined to a pipeline stage; `closedAt` is set when won or lost.',
  pipeline: 'Deal pipelines.',
  pipelineStage: 'The stages of a pipeline, with `probability` and `position`.',
  customer: 'A company that has won business. `churnedAt` is set if they left.',
  revenueEntry: 'Money, dated. `kind` separates one-off from recurring.',
  channel: 'Acquisition channels — the thing leads and spend are grouped by.',
  campaign: 'Marketing campaigns, per channel.',
  marketingSpend: 'Daily ad spend per campaign, with impressions and clicks.',
  activity: 'The log: calls, meetings, status and owner changes, per lead or deal.',
  note: 'Free-text notes on a record.',
  task: 'Follow-up tasks. `assigneeEmail` owns it.',
  appUser: 'People with an account in this app. Note most CRM record owners have none.',
  metricSnapshot: 'The time series every chart reads. One row per source/entity/metric/day.',
  integration: 'Connected data sources and their sync state. Carries no secrets.',
  website: 'Sites tracked for SEO.',
  seoKeyword: 'Tracked keywords.',
  seoKeywordRanking: 'Daily ranking positions per keyword.',
  seoPage: 'Per-page SEO metrics.',
  socialAccount: 'Connected social accounts.',
  socialPost: 'Published posts and their engagement.',
  sequence: 'Outreach sequences.',
  sequenceStep: 'The steps within a sequence.',
  prospect: 'People in outreach sequences.',
  outreachMessage: 'Individual outreach sends and their replies.',
  contentPiece: 'The content calendar.',
  aiInsight: 'Findings previously generated for the AI Insights page.',
  notification: 'In-app notifications.',
  auditEvent: 'Who changed what, and when.',
};

/**
 * The fields of each readable table, so `describe_tables` can answer "what can I filter on"
 * without a round trip through a Prisma validation error.
 *
 * Generated from prisma/schema.prisma. Embedded rather than read at runtime because the
 * schema file is not in the deployed bundle, and derived rather than hand-written because a
 * hand-written copy of a schema is a copy that goes stale.
 */
const FIELDS: Record<string, string> = {
  channel: 'id:String name:String slug:String kind:String campaigns:Campaign[] leads:Lead[] revenue:RevenueEntry[] opportunities:Opportunity[] createdAt:DateTime',
  campaign: 'id:String name:String channelId:String status:String startDate:DateTime? endDate:DateTime? budget:Decimal? currency:String budgetPeriod:String? externalId:String? source:String? notes:String? channel:Channel spend:MarketingSpend[] leads:Lead[] opportunities:Opportunity[] revenue:RevenueEntry[] content:ContentPiece[] createdAt:DateTime updatedAt:DateTime',
  marketingSpend: 'id:String campaignId:String date:DateTime amount:Decimal currency:String impressions:Int clicks:Int campaign:Campaign',
  company: 'id:String name:String nameKey:String? domain:String? industry:String? size:String? country:String? website:String? phone:String? notes:String? tags:String[] ownerEmail:String? contacts:Contact[] leads:Lead[] opportunities:Opportunity[] customer:Customer? activities:Activity[] noteEntries:Note[] tasks:Task[] externalId:String? source:String? metadata:Json? createdAt:DateTime updatedAt:DateTime',
  contact: 'id:String firstName:String lastName:String? email:String? phone:String? title:String? linkedin:String? companyId:String? tags:String[] ownerEmail:String? company:Company? leads:Lead[] opportunities:Opportunity[] activities:Activity[] noteEntries:Note[] tasks:Task[] prospects:Prospect[] externalId:String? source:String? metadata:Json? createdAt:DateTime updatedAt:DateTime',
  lead: 'id:String firstName:String lastName:String? email:String? phone:String? companyName:String? title:String? message:String? status:LeadStatus sourceDetail:String? sourceStatus:String? sourceType:SourceType ownerEmail:String? score:Int campaignId:String? channelId:String? utmSource:String? utmMedium:String? utmCampaign:String? utmTerm:String? utmContent:String? landingPage:String? referrer:String? contactId:String? companyId:String? qualifiedAt:DateTime? convertedAt:DateTime? tags:String[] campaign:Campaign? channel:Channel? contact:Contact? company:Company? opportunities:Opportunity[] activities:Activity[] noteEntries:Note[] tasks:Task[] externalId:String? source:String? metadata:Json? createdAt:DateTime updatedAt:DateTime',
  pipeline: 'id:String name:String isDefault:Boolean stages:PipelineStage[] opportunities:Opportunity[] createdAt:DateTime',
  pipelineStage: 'id:String pipelineId:String name:String position:Int probability:Int isWon:Boolean isLost:Boolean pipeline:Pipeline opportunities:Opportunity[]',
  opportunity: 'id:String name:String pipelineId:String stageId:String value:Decimal currency:String probability:Int expectedCloseDate:DateTime? closedAt:DateTime? ownerEmail:String? leadId:String? contactId:String? companyId:String? campaignId:String? sourceDetail:String? channelId:String? lostReason:String? pipeline:Pipeline stage:PipelineStage lead:Lead? contact:Contact? company:Company? campaign:Campaign? channel:Channel? customer:Customer? activities:Activity[] noteEntries:Note[] tasks:Task[] revenue:RevenueEntry[] externalId:String? source:String? metadata:Json? createdAt:DateTime updatedAt:DateTime',
  customer: 'id:String companyId:String opportunityId:String? wonAt:DateTime churnedAt:DateTime? company:Company opportunity:Opportunity? revenue:RevenueEntry[] createdAt:DateTime updatedAt:DateTime',
  revenueEntry: 'id:String customerId:String date:DateTime amount:Decimal currency:String kind:String opportunityId:String? campaignId:String? channelId:String? customer:Customer opportunity:Opportunity? campaign:Campaign? channel:Channel? createdAt:DateTime',
  activity: 'id:String type:ActivityType summary:String actorEmail:String? detail:Json? leadId:String? contactId:String? companyId:String? opportunityId:String? lead:Lead? contact:Contact? company:Company? opportunity:Opportunity? externalId:String? source:String? createdAt:DateTime',
  note: 'id:String body:String authorEmail:String leadId:String? contactId:String? companyId:String? opportunityId:String? lead:Lead? contact:Contact? company:Company? opportunity:Opportunity? createdAt:DateTime updatedAt:DateTime',
  task: 'id:String title:String detail:String? status:TaskStatus priority:Priority dueDate:DateTime? assigneeEmail:String? createdByEmail:String? completedAt:DateTime? leadId:String? contactId:String? companyId:String? opportunityId:String? lead:Lead? contact:Contact? company:Company? opportunity:Opportunity? externalId:String? source:String? createdAt:DateTime updatedAt:DateTime',
  metricSnapshot: 'id:String source:String entityType:String entityId:String metricKey:String date:DateTime value:Decimal createdAt:DateTime',
  integration: 'id:String provider:String state:IntegrationState lastSyncAt:DateTime? lastSyncRows:Int? syncCursor:Json? syncedThrough:DateTime? lastError:String? lastErrorAt:DateTime? connectedByEmail:String? connectedAt:DateTime? config:Json? credential:IntegrationCredential? createdAt:DateTime updatedAt:DateTime',
  appUser: 'id:String email:String name:String initials:String displayRole:String? team:String? role:Role active:Boolean lastSeenAt:DateTime? createdAt:DateTime updatedAt:DateTime',
  website: 'id:String domain:String name:String keywords:SeoKeyword[] pages:SeoPage[] createdAt:DateTime',
  seoKeyword: 'id:String websiteId:String keyword:String country:String searchVolume:Int? difficulty:Int? cpc:Decimal? intent:String? isTracked:Boolean source:String? website:Website rankings:SeoKeywordRanking[] createdAt:DateTime',
  seoKeywordRanking: 'id:String keywordId:String date:DateTime position:Int url:String? keyword:SeoKeyword',
  seoPage: 'id:String websiteId:String url:String title:String? clicks:Int impressions:Int ctr:Float avgPosition:Float issues:Json? source:String? website:Website updatedAt:DateTime',
  socialAccount: 'id:String network:SocialNetwork handle:String name:String? followers:Int integrationId:String? posts:SocialPost[] createdAt:DateTime updatedAt:DateTime',
  socialPost: 'id:String accountId:String externalId:String? publishedAt:DateTime permalink:String? caption:String? reach:Int impressions:Int likes:Int comments:Int shares:Int saves:Int clicks:Int account:SocialAccount createdAt:DateTime',
  sequence: 'id:String name:String status:String ownerEmail:String? steps:SequenceStep[] prospects:Prospect[] externalId:String? source:String? createdAt:DateTime updatedAt:DateTime',
  sequenceStep: 'id:String sequenceId:String position:Int waitDays:Int channel:String subject:String? body:String sequence:Sequence messages:OutreachMessage[]',
  prospect: 'id:String sequenceId:String contactId:String? email:String firstName:String? lastName:String? companyName:String? status:ProspectStatus currentStep:Int sequence:Sequence contact:Contact? messages:OutreachMessage[] externalId:String? source:String? createdAt:DateTime updatedAt:DateTime',
  outreachMessage: 'id:String prospectId:String stepId:String status:String providerId:String? sentAt:DateTime openedAt:DateTime? repliedAt:DateTime? error:String? prospect:Prospect step:SequenceStep',
  contentPiece: 'id:String title:String status:ContentStatus format:String authorEmail:String? channelSlug:String? campaignId:String? brief:String? url:String? publishDate:DateTime? views:Int leadsGenerated:Int tags:String[] campaign:Campaign? createdAt:DateTime updatedAt:DateTime',
  aiInsight: 'id:String kind:InsightKind title:String body:String provider:String model:String? context:Json? confidence:Int? dismissedAt:DateTime? createdAt:DateTime',
  notification: 'id:String title:String body:String? level:String href:String? forEmail:String? readAt:DateTime? createdAt:DateTime',
  auditEvent: 'id:String actorEmail:String action:String entityType:String entityId:String? detail:Json? createdAt:DateTime',
};

/** The tool definitions handed to the model. `strict` is off: Prisma's `where` and `select`
 *  shapes are recursive and cannot be expressed as a closed JSON schema, so the objects are
 *  free-form here and validated by Prisma itself when the query runs. */
export const READ_TOOLS = [
  {
    type: 'function' as const,
    name: 'describe_tables',
    description:
      'List the readable tables, or with `tables` given, the fields of those tables. Call this before querying a table whose field names you are not sure of.',
    strict: false,
    parameters: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Table names to describe in full. Omit for the list of all tables.',
        },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'query',
    description:
      `Read rows from one table. Returns at most ${MAX_ROWS}. Use \`count\` for "how many" and \`group\` for totals per category — paging through rows to add them up is slow and wrong.`,
    strict: false,
    parameters: {
      type: 'object',
      required: ['table'],
      properties: {
        table: { type: 'string', description: 'One of the tables from describe_tables.' },
        where: { type: 'object', description: 'A Prisma where filter, e.g. {"status":"new","createdAt":{"gte":"2026-06-01"}}.' },
        select: { type: 'object', description: 'Fields to return, e.g. {"id":true,"email":true}. Omit for all scalar fields.' },
        orderBy: { type: 'object', description: 'e.g. {"createdAt":"desc"}.' },
        take: { type: 'number', description: `Rows to return, 1-${MAX_ROWS}.` },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'count',
    description: 'Count rows in a table matching a filter. Always prefer this over counting returned rows.',
    strict: false,
    parameters: {
      type: 'object',
      required: ['table'],
      properties: {
        table: { type: 'string' },
        where: { type: 'object' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'group',
    description:
      'Group rows and count each group — "leads per owner", "deals per stage". Optionally sum numeric fields.',
    strict: false,
    parameters: {
      type: 'object',
      required: ['table', 'by'],
      properties: {
        table: { type: 'string' },
        by: { type: 'array', items: { type: 'string' }, description: 'Fields to group by.' },
        where: { type: 'object' },
        sum: { type: 'array', items: { type: 'string' }, description: 'Numeric fields to total per group.' },
        orderBy: {
          type: 'object',
          description:
            'How to order the groups. {"_sum":{"value":"desc"}} for the largest total first — use this when the question asks which group is biggest by an amount. Defaults to the largest group by row count.',
        },
        take: { type: 'number', description: `Groups to return, 1-${MAX_ROWS}.` },
      },
    },
  },
];

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const clamp = (n: unknown, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(Math.max(v, 1), MAX_ROWS);
};

/**
 * The Prisma delegate for an allowlisted table, or null if the database is unreachable.
 *
 * Deliberately does NOT decide whether the table is readable — `runReadTool` checks the
 * allowlist before calling this. Conflating the two told the model that "lead is not a
 * readable table" whenever DATABASE_URL was unset, which is a false statement about the
 * allowlist and sends the model off to call describe_tables for a list it already had.
 */
function delegateFor(table: string) {
  const client = prisma();
  if (!client) return null;
  const d = (client as unknown as Record<string, unknown>)[table];
  return d && typeof d === 'object' ? (d as Record<string, (args: unknown) => Promise<unknown>>) : null;
}

const unknownTable = (table: unknown): ToolResult => ({
  ok: false,
  error: `"${String(table)}" is not a readable table. Call describe_tables for the list.`,
});

export async function runReadTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (name === 'describe_tables') {
      const asked = Array.isArray(args.tables) ? (args.tables as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      if (!asked.length) return { ok: true, data: TABLES };

      const described: Record<string, { purpose: string; fields: string }> = {};
      for (const t of asked) {
        if (!(t in TABLES)) return unknownTable(t);
        described[t] = { purpose: TABLES[t], fields: FIELDS[t] ?? '(unknown)' };
      }
      return { ok: true, data: described };
    }

    // Allowlist first, and before anything touches Prisma: an unlisted name is refused
    // identically whether or not the database is up.
    if (typeof args.table !== 'string' || !(args.table in TABLES)) return unknownTable(args.table);

    // Argument validation next, for the same reason — a malformed call should say what was
    // wrong with it rather than reporting a connection problem.
    const by = Array.isArray(args.by) ? (args.by as unknown[]).filter((f): f is string => typeof f === 'string') : [];
    if (name === 'group' && !by.length) {
      return { ok: false, error: 'group needs at least one field in `by`.' };
    }

    if (!['query', 'count', 'group'].includes(name)) {
      return { ok: false, error: `Unknown tool "${name}".` };
    }

    const model = delegateFor(args.table);
    if (!model) return { ok: false, error: 'The database is not reachable, so nothing can be read.' };

    if (name === 'count') {
      return { ok: true, data: { count: await model.count({ where: args.where ?? undefined }) } };
    }

    if (name === 'query') {
      const rows = await model.findMany({
        where: args.where ?? undefined,
        select: args.select ?? undefined,
        orderBy: args.orderBy ?? undefined,
        take: clamp(args.take, DEFAULT_ROWS),
      });
      const returned = Array.isArray(rows) ? rows.length : 0;
      return {
        ok: true,
        // The cap is reported, not hidden. A model that reads 50 of 2,000 rows and treats
        // them as the whole set draws a confident conclusion from a page of data.
        data: { rows, returned, capped: returned >= MAX_ROWS ? `Only the first ${MAX_ROWS} rows are shown — use count or group for totals.` : undefined },
      };
    }

    const sum = Array.isArray(args.sum) ? (args.sum as unknown[]).filter((f): f is string => typeof f === 'string') : [];
    const groups = await model.groupBy({
      by,
      where: args.where ?? undefined,
      _count: { _all: true },
      ...(sum.length ? { _sum: Object.fromEntries(sum.map((f) => [f, true])) } : {}),
      // An orderBy is not optional here: Prisma rejects `take` on a groupBy without one, so
      // every capped grouping failed outright with "Every field used for orderBy must be
      // included in the by-arguments".
      //
      // The model chooses it, because a fixed default silently answers a different question
      // than the one asked. Asked which pipeline stage holds the most value, the model
      // grouped and summed correctly and then read the first group — which count-ordering
      // had made the largest by DEAL COUNT, not by value. On this data those happen to be
      // the same stage, so the answer came out right for a reason that does not hold; the
      // next dataset would have it confidently wrong with nothing on screen to show why.
      orderBy: args.orderBy ?? { _count: { [by[0]]: 'desc' } },
      take: clamp(args.take, MAX_ROWS),
    });
    return { ok: true, data: groups };

    return { ok: false, error: `Unknown tool "${name}".` };
  } catch (e) {
    // Prisma puts the human sentence on the last line and a pretty-printed copy of the
    // whole argument object above it — for a bad field on `lead`, fifty-odd lines of type
    // signatures. Taking the last few lines returned "orderBy: undefined, take: 20 }
    // Unknown argument `notAField`": the useful sentence with query wreckage stapled to the
    // front. Only the last line is the explanation.
    const lines = (e as Error).message.split('\n').filter((l) => l.trim());
    const sentence = lines[lines.length - 1]?.trim() ?? '';

    // That sentence ends by referring to a list of valid fields marked with "?", which is
    // exactly the part being dropped. Pointed at the tool that does answer it instead, or
    // the model is told to read something it cannot see.
    const explanation = sentence.replace(
      /Available options are marked with \?\.?/,
      'Call describe_tables for the valid fields.',
    );

    return { ok: false, error: (explanation || (e as Error).message).slice(0, 600) || 'The query failed.' };
  }
}

/** True when the database is reachable, so `ask()` can leave the tools off entirely rather
 *  than offering the model something every call to which would fail. */
export const canRead = () => !!prisma();
