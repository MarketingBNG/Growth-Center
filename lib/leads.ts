import { z } from 'zod';
import { db } from './prisma.ts';
import { dispatch } from './events.ts';
import { companyDomainFromEmail, normalizeCompanyName, normalizeEmail } from './dedupe.ts';
import type { ListQuery } from './api.ts';
import { LEAD_STATUSES, SOURCE_TYPES } from './enums.ts';
import { channelSlugFor } from './integrations/crm-mapping.ts';


export const leadInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().max(160).optional(),
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().max(4000).optional(),
  sourceType: z.enum(SOURCE_TYPES).default('manual'),
  campaignId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
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
  ownerEmail: z.string().trim().optional(),
  campaignId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export type LeadFilters = z.infer<typeof leadFilters>;

const SORTABLE = ['createdAt', 'updatedAt', 'status', 'score', 'firstName'] as const;

/**
 * `window` is the range the picker resolved, applied only when the URL carries no
 * explicit `from`/`to`. Without it the range picker sat above a table it did not filter:
 * choosing "Last 7 days" moved the KPIs and the chart while the list below kept showing
 * all 27,256 leads, and the pager said so.
 *
 * An explicit `from`/`to` still wins — the CRM page's owner links carry one, and the list
 * it opens must match the number that was clicked.
 */
export function leadWhere(filters: LeadFilters, q: ListQuery, window?: { from: Date; to: Date }) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.sourceType) where.sourceType = filters.sourceType;
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
    ];
  }
  return where;
}

export async function listLeads(
  filters: LeadFilters,
  q: ListQuery,
  window?: { from: Date; to: Date },
) {
  const where = leadWhere(filters, q, window);
  const key = (SORTABLE as readonly string[]).includes(q.sort ?? '') ? q.sort! : 'createdAt';

  const [rows, total] = await Promise.all([
    db().lead.findMany({
      where,
      orderBy: { [key]: q.dir },
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
  const duplicate = await findDuplicateLead(input.email);
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

  // Attribution is resolved here rather than at each call site so a lead from the public
  // form, the UI and an import are all credited the same way.
  const attribution = await resolveCampaign(input);

  // Falling back to the channel the source type implies, which is what the CRM import
  // does. Without it a website form submission — the one path that is unambiguously the
  // site's own — arrived with no channel unless it happened to carry a utm_campaign that
  // matched a stored campaign by name.
  const channelId =
    attribution.channelId ?? input.channelId ?? (await channelIdForSource(input.sourceType));

  const lead = await db().lead.create({
    data: {
      ...input,
      email: normalizeEmail(input.email),
      ownerEmail: input.ownerEmail ?? null,
      campaignId: attribution.campaignId ?? input.campaignId ?? null,
      channelId,
    },
    select: { id: true },
  });

  await db().activity.create({
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
  });

  await linkToCrm(lead.id, input);
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
      (await db().company.create({ data: { name, nameKey }, select: { id: true } })).id;
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
