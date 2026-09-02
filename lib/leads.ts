import { cache } from 'react';
import { z } from 'zod';
import { recordId } from './id.ts';
import { db } from './prisma.ts';
import { dispatch } from './events.ts';
import { companyDomainFromEmail, normalizeCompanyName, normalizeEmail } from './dedupe.ts';
import type { ListQuery } from './api.ts';
import { LEAD_STATUSES, SOURCE_TYPES } from './enums.ts';
import {
  channelSlugFor,
  leadCampaign,
  leadSourceGroup,
  LEAD_CAMPAIGNS,
  LEAD_SOURCES,
  LEAD_SOURCE_KEYS,
  type LeadCampaign,
  type LeadSourceKey,
} from './integrations/crm-mapping.ts';
import { INTERNAL_SOURCE } from './sources.ts';
import { phoneMatches } from './phone.ts';


export const leadInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().max(160).optional(),
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().max(4000).optional(),
  sourceType: z.enum(SOURCE_TYPES).default('manual'),
  campaignId: recordId.optional(),
  channelId: recordId.optional(),
  ownerEmail: z.string().trim().email().optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(160).optional(),
  utmTerm: z.string().trim().max(160).optional(),
  utmContent: z.string().trim().max(160).optional(),
  landingPage: z.string().trim().max(500).optional(),
  referrer: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export type LeadInput = z.infer<typeof leadInput>;

export const leadFilters = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  /** The CRM's own source, grouped — see leadSourceGroup. Distinct from `sourceType`
   *  above, which stays for the public API: that is the shared enum a form posting a
   *  lead can name, and it cannot express "Canada" or "Incorp". */
  leadSource: z.enum(LEAD_SOURCE_KEYS).optional(),
  /** The business line the CRM's source string names — see leadCampaign. Distinct from
   *  `campaignId` below, which is a real Campaign row and is null on every lead here. */
  leadCampaign: z.enum(LEAD_CAMPAIGNS).optional(),
  ownerEmail: z.string().trim().optional(),
  campaignId: recordId.optional(),
  channelId: recordId.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export type LeadFilters = z.infer<typeof leadFilters>;

// Every column the table actually shows a header for, so a sortable header exists for
// each. All are Lead scalars — the allow-list is what keeps `?sort=` out of a relation
// or an arbitrary field.
const SORTABLE = [
  'createdAt', 'updatedAt', 'status', 'score', 'firstName',
  'companyName', 'sourceType', 'sourceDetail', 'ownerEmail',
] as const;

/**
 * Every distinct CRM source string, with how many leads carry it. ~56 rows over 27k
 * leads.
 *
 * `cache` is React's per-request dedupe, and it is doing real work here: rendering the
 * Leads page with a source filter set called this twice — once to build the dropdown and
 * once to turn the chosen group into a WHERE clause — which was two full scans of the
 * lead table, ~250ms each, for one answer that cannot change between them.
 */
const sourceDetailCounts = cache(async () =>
  db().lead.groupBy({ by: ['sourceDetail'], _count: { _all: true } }),
);

/**
 * The distinct CRM source strings that belong to one group, for the WHERE clause.
 *
 * The group is computed, not stored, so it cannot be matched in SQL: the rules have a
 * precedence a set of ORed LIKEs cannot express — "Meta - Landing Page" is Meta Ads and
 * "Trademark - Landingpage" is Landing Page, and both contain "landing". So the distinct
 * values are grouped in JS, which is exactly the same decision the column renders and
 * cannot drift from it.
 */
async function sourceDetailsIn(group: LeadSourceKey): Promise<string[]> {
  return (await sourceDetailCounts())
    .map((r) => r.sourceDetail)
    .filter((d): d is string => d !== null && leadSourceGroup(d) === group);
}

/** The same, for the campaign the source string names. */
async function campaignDetailsIn(campaign: LeadCampaign): Promise<string[]> {
  return (await sourceDetailCounts())
    .map((r) => r.sourceDetail)
    .filter((d): d is string => d !== null && leadCampaign(d) === campaign);
}

/**
 * The campaign filter's options, busiest first.
 *
 * Only the lines this CRM actually names. Ten are defined and this account uses all ten,
 * but a workspace that never ran a Trademark ad should not be offered one.
 */
export async function leadCampaignOptions() {
  const totals = new Map<LeadCampaign, number>();
  for (const r of await sourceDetailCounts()) {
    const key = leadCampaign(r.sourceDetail);
    if (key) totals.set(key, (totals.get(key) ?? 0) + r._count._all);
  }

  return LEAD_CAMPAIGNS.filter((c) => totals.has(c))
    .sort((a, b) => totals.get(b)! - totals.get(a)!)
    .map((c) => ({ value: c, label: c }));
}

/**
 * The source filter's options: the groups that actually have leads behind them, busiest
 * first. Offering the whole vocabulary would put ten dead options in the dropdown — this
 * CRM writes no organic search at all — and picking one returns an empty table, which
 * reads as a broken page rather than as an empty source.
 *
 * Counted over the whole table, not the visible date range, so the list does not shuffle
 * itself every time the range picker moves.
 */
export async function leadSourceOptions() {
  const totals = new Map<LeadSourceKey, number>();
  for (const r of await sourceDetailCounts()) {
    const key = leadSourceGroup(r.sourceDetail);
    totals.set(key, (totals.get(key) ?? 0) + r._count._all);
  }

  return LEAD_SOURCES.filter((s) => totals.has(s.key))
    .sort((a, b) => totals.get(b.key)! - totals.get(a.key)!)
    .map((s) => ({ value: s.key, label: s.label }));
}

/**
 * `window` is the range the picker resolved, applied only when the URL carries no
 * explicit `from`/`to`. Without it the range picker sat above a table it did not filter:
 * choosing "Last 7 days" moved the KPIs and the chart while the list below kept showing
 * all 27,256 leads, and the pager said so.
 *
 * An explicit `from`/`to` still wins — the CRM page's owner links carry one, and the list
 * it opens must match the number that was clicked.
 */
export async function leadWhere(filters: LeadFilters, q: ListQuery, window?: { from: Date; to: Date }) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.leadSource) {
    // Null is the group, not a value in it: the 104 leads Zoho recorded no source for are
    // what "Unattributed" means, and `sourceDetail: { in: [] }` would match none of them.
    where.sourceDetail =
      filters.leadSource === 'unattributed'
        ? null
        : { in: await sourceDetailsIn(filters.leadSource) };
  }
  if (filters.leadCampaign) {
    // Both filters narrow the same column, so they have to be intersected rather than
    // overwrite each other. Composing them is the point: Incorporation on LinkedIn is
    // `?leadSource=linkedin&leadCampaign=Incorporation`, which is the question the
    // marketing review actually asks.
    const details = await campaignDetailsIn(filters.leadCampaign);
    const already = where.sourceDetail;
    if (already === null) {
      // Source filter is "Unattributed", which means sourceDetail IS NULL — and a null
      // source names no campaign, so the two together match nothing. Said explicitly:
      // `typeof null === 'object'` is true, so the object branch below would have
      // silently dropped the null and returned every campaign lead instead.
      where.sourceDetail = { in: [] };
    } else if (already && typeof already === 'object') {
      const kept = new Set((already as { in: string[] }).in);
      where.sourceDetail = { in: details.filter((d) => kept.has(d)) };
    } else {
      where.sourceDetail = { in: details };
    }
  }
  if (filters.ownerEmail) {
    where.ownerEmail = filters.ownerEmail === 'unassigned' ? null : filters.ownerEmail;
  }
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.channelId) where.channelId = filters.channelId;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59Z`) } : {}),
    };
  } else if (window) {
    where.createdAt = { gte: window.from, lte: window.to };
  }

  if (q.q) {
    where.OR = [
      { firstName: { contains: q.q, mode: 'insensitive' } },
      { lastName: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      { companyName: { contains: q.q, mode: 'insensitive' } },
      // 7,267 leads carry a phone number and none of them could be found by it, though
      // the CRM's lists have searched on one since they were fixed.
      { phone: { contains: q.q, mode: 'insensitive' } },
      ...(await phoneMatches('lead', q.q)).map((id) => ({ id })),
    ];
  }
  return where;
}

/** The sortable columns that allow a null. Postgres puts nulls first on DESC, so sorting
 *  by Company or Owner descending opened with a screenful of blanks; these ask for them
 *  at the end instead, in both directions. */
const NULLABLE_SORTS = new Set(['companyName', 'ownerEmail', 'lastName', 'sourceDetail']);

export async function listLeads(
  filters: LeadFilters,
  q: ListQuery,
  window?: { from: Date; to: Date },
) {
  const where = await leadWhere(filters, q, window);
  const key = (SORTABLE as readonly string[]).includes(q.sort ?? '') ? q.sort! : 'createdAt';
  const orderBy = NULLABLE_SORTS.has(key)
    ? { [key]: { sort: q.dir, nulls: 'last' as const } }
    : { [key]: q.dir };

  const [rows, total] = await Promise.all([
    db().lead.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        campaign: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } },
      },
    }),
    db().lead.count({ where }),
  ]);
  return { rows, total };
}

export async function getLead(id: string) {
  return db().lead.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      channel: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      company: { select: { id: true, name: true, domain: true } },
      opportunities: { select: { id: true, name: true, value: true, currency: true, stage: { select: { name: true } } } },
      activities: { orderBy: { createdAt: 'desc' } },
      noteEntries: { orderBy: { createdAt: 'desc' } },
      tasks: { where: { status: { in: ['open', 'in_progress'] } }, orderBy: { dueDate: 'asc' } },
    },
  });
}

/**
 * Finds an existing lead for the same person before creating another. Matches on
 * normalized email only — a name-plus-company match produced false merges in testing
 * (two people at one company enquiring about different things became one lead).
 *
 * Converted and lost leads are excluded: someone returning a year later is a new
 * opportunity, not an update to a closed record.
 */
/** The activity summary a merged duplicate writes. Exported because `lib/metrics.ts`
 *  counts these rows for the "Duplicates merged" KPI — a literal in two files would
 *  silently zero that number the day this wording changes. */
export const DUPLICATE_MERGED_SUMMARY = 'Duplicate submission merged into this lead';

export async function findDuplicateLead(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  // An indexed lookup on the normalized address, not a scan.
  //
  // This used to fetch the 500 most recent open leads and compare them in memory, which
  // meant dedupe silently stopped working once the table passed 500 rows: a returning
  // enquirer became a brand new lead, with no error and a quietly under-reported
  // "Duplicates merged" figure. `createLead` stores `normalizeEmail(...)`, so stored
  // addresses are already normalized, and Lead has @@index([email]) — so the correct
  // query is also the cheap one, at any table size.
  // Both forms, because rows written before normalization existed (and by an older seed)
  // are stored raw — an identical raw resubmission must still match those. Both are
  // equality checks against the same index.
  const forms = [...new Set([normalized, (email ?? '').trim().toLowerCase()])].filter(Boolean);

  return db().lead.findFirst({
    where: { email: { in: forms }, status: { notIn: ['converted', 'lost'] } },
    select: { id: true, email: true, firstName: true, lastName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export type CreateLeadResult =
  | { created: true; leadId: string }
  | { created: false; leadId: string; reason: 'duplicate' };


/**
 * Resolves the campaign a form submission came from.
 *
 * Inbound forms carry utm_campaign; campaigns carry the ad platform's own name. Nothing
 * joined the two, so every lead from a real Meta campaign arrived unattributed and the
 * only live channel showed real spend against an empty funnel — no CPL, no CAC, no ROAS.
 *
 * Matching is exact on name first, then case-insensitively, and never fuzzily: crediting
 * revenue to the wrong campaign is worse than crediting it to none. utm_source narrows
 * the search when two platforms use the same campaign name.
 *
 * An explicit campaignId always wins — it means a human chose.
 */
export async function resolveCampaign(input: {
  campaignId?: string;
  utmCampaign?: string;
  utmSource?: string;
}): Promise<{ campaignId?: string; channelId?: string }> {
  if (input.campaignId) return { campaignId: input.campaignId };

  const name = (input.utmCampaign ?? '').trim();
  if (!name) return {};

  // utm_source=facebook|meta means only look at Meta's campaigns, and so on.
  const source = (input.utmSource ?? '').trim().toLowerCase();
  const sourceFilter =
    source.includes('facebook') || source.includes('meta') || source.includes('instagram')
      ? 'meta_ads'
      : source.includes('google')
        ? 'google_ads'
        : source.includes('linkedin')
          ? 'linkedin_ads'
          : null;

  const scope = sourceFilter ? { source: sourceFilter } : {};

  const exact = await db().campaign.findFirst({
    where: { ...scope, name },
    select: { id: true, channelId: true },
  });
  if (exact) return { campaignId: exact.id, channelId: exact.channelId };

  const loose = await db().campaign.findFirst({
    where: { ...scope, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, channelId: true },
  });
  if (loose) return { campaignId: loose.id, channelId: loose.channelId };

  return {};
}

/** The channel a source type belongs to, resolved to an id. Null when the source has no
 *  channel of its own — naming one would be invented attribution. */
async function channelIdForSource(sourceType: LeadInput['sourceType']): Promise<string | null> {
  const slug = channelSlugFor(sourceType);
  if (!slug) return null;
  const channel = await db().channel.findUnique({ where: { slug }, select: { id: true } });
  return channel?.id ?? null;
}

export async function createLead(
  input: LeadInput,
  actorEmail: string | null,
): Promise<CreateLeadResult> {
  // Three independent reads, issued together rather than one after another. Each round
  // trip to the database costs ~280ms from a dev machine and the create path made a
  // dozen of them in series, so "Create lead" sat spinning for four seconds. The two
  // attribution lookups are wasted work on the rare duplicate, which is a fair trade
  // for removing two round trips from every real create.
  const [duplicate, attribution, fallbackChannelId] = await Promise.all([
    findDuplicateLead(input.email),
    resolveCampaign(input),
    channelIdForSource(input.sourceType),
  ]);

  if (duplicate) {
    // Record the repeat touch on the existing lead rather than dropping it silently —
    // "they filled the form again" is information the owner needs.
    await db().activity.create({
      data: {
        type: 'created',
        summary: DUPLICATE_MERGED_SUMMARY,
        actorEmail,
        detail: { sourceType: input.sourceType, message: input.message ?? null },
        leadId: duplicate.id,
      },
    });
    return { created: false, leadId: duplicate.id, reason: 'duplicate' };
  }

  // Attribution is resolved above rather than at each call site so a lead from the public
  // form, the UI and an import are all credited the same way.
  //
  // Falling back to the channel the source type implies, which is what the CRM import
  // does. Without it a website form submission — the one path that is unambiguously the
  // site's own — arrived with no channel unless it happened to carry a utm_campaign that
  // matched a stored campaign by name.
  const channelId = attribution.channelId ?? input.channelId ?? fallbackChannelId;

  const lead = await db().lead.create({
    data: {
      ...input,
      email: normalizeEmail(input.email),
      ownerEmail: input.ownerEmail ?? null,
      // Stamped, because a null source is read as the seeder's and badged amber "never
      // real". A lead from the site's own form is as real as one Zoho sent.
      source: INTERNAL_SOURCE,
      campaignId: attribution.campaignId ?? input.campaignId ?? null,
      channelId,
    },
    select: { id: true },
  });

  // The history row and the CRM links touch different tables and neither reads the
  // other's work, so they go together rather than in series.
  await Promise.all([
    db().activity.create({
      data: {
        type: 'created',
        summary: `Lead created from ${input.sourceType.replace('_', ' ')}`,
        actorEmail,
        detail: {
          sourceType: input.sourceType,
          utmSource: input.utmSource ?? null,
          utmCampaign: input.utmCampaign ?? null,
          attributed: !!attribution.campaignId,
        },
        leadId: lead.id,
      },
    }),
    linkToCrm(lead.id, input),
  ]);

  // Awaited, not deferred: this is what assigns the owner, and the caller navigates
  // straight to the lead's page — returning first would land the reader on a lead that
  // says Unassigned until they reload.
  await dispatch({ type: 'lead.created', leadId: lead.id, actorEmail });

  return { created: true, leadId: lead.id };
}

/**
 * Attaches the lead to a Company (by email domain or name) and a Contact (by email),
 * creating either if absent. Runs on create so the CRM is populated by inbound leads
 * rather than by hand.
 */
async function linkToCrm(leadId: string, input: LeadInput) {
  const email = normalizeEmail(input.email);
  const domain = companyDomainFromEmail(input.email);

  let companyId: string | null = null;
  if (domain) {
    const company = await db().company.upsert({
      where: { domain },
      create: {
        name: input.companyName?.trim() || domain,
        nameKey: normalizeCompanyName(input.companyName?.trim() || domain),
        domain,
        source: INTERNAL_SOURCE,
      },
      update: {},
      select: { id: true },
    });
    companyId = company.id;
  } else if (input.companyName) {
    // Matched on the normalised form, which is what normalizeCompanyName is for. The
    // lookup used to compare the raw name case-insensitively and discard the normalised
    // value, so "Acme, Inc." and "Acme Inc" became two accounts — the exact duplicate
    // the function exists to prevent.
    const name = input.companyName.trim();
    const nameKey = normalizeCompanyName(name);

    const existing = nameKey
      ? await db().company.findFirst({ where: { nameKey }, select: { id: true } })
      : null;

    companyId =
      existing?.id ??
      (await db().company.create({
        data: { name, nameKey, source: INTERNAL_SOURCE },
        select: { id: true },
      })).id;
  }

  let contactId: string | null = null;
  if (email) {
    const contact = await db().contact.upsert({
      where: { email },
      create: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email,
        phone: input.phone ?? null,
        title: input.title ?? null,
        companyId,
        source: INTERNAL_SOURCE,
      },
      update: { companyId: companyId ?? undefined },
      select: { id: true },
    });
    contactId = contact.id;
  }

  if (companyId || contactId) {
    await db().lead.update({ where: { id: leadId }, data: { companyId, contactId } });
  }
}

export async function setLeadStatus(
  id: string,
  status: (typeof LEAD_STATUSES)[number],
  actorEmail: string,
) {
  const before = await db().lead.findUnique({ where: { id }, select: { status: true } });
  if (!before) return null;
  if (before.status === status) return { unchanged: true as const };

  await db().lead.update({
    where: { id },
    data: {
      status,
      qualifiedAt: status === 'qualified' ? new Date() : undefined,
      convertedAt: status === 'converted' ? new Date() : undefined,
    },
  });

  await db().activity.create({
    data: {
      type: 'status_changed',
      summary: `Status changed from ${before.status} to ${status}`,
      actorEmail,
      detail: { from: before.status, to: status },
      leadId: id,
    },
  });

  if (status === 'qualified') await dispatch({ type: 'lead.qualified', leadId: id, actorEmail });
  return { unchanged: false as const };
}

export async function setLeadOwner(id: string, ownerEmail: string | null, actorEmail: string) {
  const before = await db().lead.findUnique({ where: { id }, select: { ownerEmail: true } });
  if (!before) return null;

  await db().lead.update({ where: { id }, data: { ownerEmail } });
  await db().activity.create({
    data: {
      type: 'owner_changed',
      summary: ownerEmail ? `Assigned to ${ownerEmail}` : 'Owner cleared',
      actorEmail,
      detail: { from: before.ownerEmail, to: ownerEmail },
      leadId: id,
    },
  });
  return { ok: true };
}
