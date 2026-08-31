import { z } from 'zod';
import { db } from './prisma.ts';
import { normalizeCompanyName, normalizeDomain, normalizeEmail } from './dedupe.ts';
import { INTERNAL_SOURCE } from './sources.ts';
import type { ListQuery } from './api.ts';

export const companyInput = z.object({
  name: z.string().trim().min(1).max(160),
  domain: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(80).optional(),
  size: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  website: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(4000).optional(),
  ownerEmail: z.string().trim().email().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const contactInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(120).optional(),
  linkedin: z.string().trim().max(300).optional(),
  companyId: z.string().cuid().optional(),
  ownerEmail: z.string().trim().email().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const noteInput = z.object({
  body: z.string().trim().min(1).max(8000),
  leadId: z.string().cuid().optional(),
  contactId: z.string().cuid().optional(),
  companyId: z.string().cuid().optional(),
  opportunityId: z.string().cuid().optional(),
});

export const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.string().date().optional(),
  assigneeEmail: z.string().trim().email().optional(),
  leadId: z.string().cuid().optional(),
  contactId: z.string().cuid().optional(),
  companyId: z.string().cuid().optional(),
  opportunityId: z.string().cuid().optional(),
});

/** Every field optional: a PATCH that renames a company must not have to resend it all. */
export const companyPatch = companyInput.partial();
export const contactPatch = contactInput.partial();

export type CompanyInput = z.infer<typeof companyInput>;
export type ContactInput = z.infer<typeof contactInput>;
export type NoteInput = z.infer<typeof noteInput>;
export type TaskInput = z.infer<typeof taskInput>;

/** Exactly one parent must be named, or a note/task would attach to nothing (or to
 *  several records at once, which the detail views would each claim as their own). */
export function singleParent(input: {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
}): boolean {
  return (
    [input.leadId, input.contactId, input.companyId, input.opportunityId].filter(Boolean).length === 1
  );
}

/** The Owner dropdown's value for "nobody holds this", which is a real thing to filter
 *  on and cannot be expressed as an email. */
export const UNASSIGNED = 'unassigned';

export type CompanyFilters = { ownerEmail?: string; status?: 'customer' | 'prospect' };
export type ContactFilters = { ownerEmail?: string; companyId?: string };

const COMPANY_SORT = ['name', 'createdAt', 'updatedAt'] as const;
const CONTACT_SORT = ['lastName', 'firstName', 'createdAt', 'updatedAt'] as const;

/**
 * Ids whose phone number contains these digits, however the number is punctuated.
 *
 * Phones arrive from the CRM exactly as somebody typed them — "98101 89048",
 * "+91 9008858515", "(917) 981-9599" — so a `contains` on the search box missed every
 * number a reader would type from memory. This strips the punctuation on both sides in
 * the database and matches on digits alone.
 *
 * The character class is spelled out rather than written `\D`: a backslash escape has to
 * survive both the JavaScript string and Postgres, and the one that reached the database
 * matched a literal D, so the query stripped the letter and left the spaces in place.
 *
 * The table name is a literal from a union, never caller input; the digits are bound as a
 * parameter. Capped, because the id list goes back into a Prisma `in`.
 */
async function phoneMatches(table: 'company' | 'contact', term: string): Promise<string[]> {
  const digits = term.replace(/\D/g, '');
  // Under four digits matches most of the book and is never what someone means by a
  // phone search.
  if (digits.length < 4) return [];

  const rows = await db().$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE $1 LIMIT 500`,
    `%${digits}%`,
  );
  return rows.map((r) => r.id);
}

export async function listCompanies(q: ListQuery, filters: CompanyFilters = {}) {
  const where: Record<string, unknown> = {};
  if (filters.ownerEmail) {
    where.ownerEmail = filters.ownerEmail === UNASSIGNED ? null : filters.ownerEmail;
  }
  // A company is a customer when it has a customer row — the same test the Status column
  // renders, so the filter and the badge can never disagree.
  if (filters.status === 'customer') where.customer = { isNot: null };
  if (filters.status === 'prospect') where.customer = { is: null };

  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { domain: { contains: q.q, mode: 'insensitive' } },
      // Phone rather than industry. The box offers to search what the rows actually hold,
      // and industry is empty on every imported company, so it could only ever match the
      // handful entered by hand while a phone number matches most of the table.
      { phone: { contains: q.q, mode: 'insensitive' } },
      ...(await phoneMatches('company', q.q)).map((id) => ({ id })),
    ];
  }
  // A–Z by default, because that is how you look a company up. But once someone asks for
  // a column by name, `dir` is theirs: the direction was pinned to 'asc' for `name`, so
  // clicking the Company header to reverse it changed nothing.
  const chosen = (COMPANY_SORT as readonly string[]).includes(q.sort ?? '');
  const key = chosen ? q.sort! : 'name';

  const [rows, total] = await Promise.all([
    db().company.findMany({
      where,
      orderBy: { [key]: chosen ? q.dir : 'asc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        _count: { select: { contacts: true, opportunities: true } },
        customer: { select: { wonAt: true } },
      },
    }),
    db().company.count({ where }),
  ]);
  return { rows, total };
}

export async function listContacts(q: ListQuery, filters: ContactFilters = {}) {
  const where: Record<string, unknown> = {};
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.ownerEmail) {
    where.ownerEmail = filters.ownerEmail === UNASSIGNED ? null : filters.ownerEmail;
  }
  if (q.q) {
    where.OR = [
      { firstName: { contains: q.q, mode: 'insensitive' } },
      { lastName: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q, mode: 'insensitive' } },
      ...(await phoneMatches('contact', q.q)).map((id) => ({ id })),
    ];
  }
  const key = (CONTACT_SORT as readonly string[]).includes(q.sort ?? '') ? q.sort! : 'createdAt';

  const [rows, total] = await Promise.all([
    db().contact.findMany({
      where,
      orderBy: { [key]: q.dir },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: { company: { select: { id: true, name: true } } },
    }),
    db().contact.count({ where }),
  ]);
  return { rows, total };
}

export async function getCompany(id: string) {
  return db().company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: 'desc' } },
      leads: { orderBy: { createdAt: 'desc' }, take: 20 },
      opportunities: {
        orderBy: { updatedAt: 'desc' },
        include: { stage: { select: { name: true, isWon: true, isLost: true } } },
      },
      customer: { include: { revenue: { orderBy: { date: 'desc' }, take: 24 } } },
      noteEntries: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      // Open ones only, as getLead already did. The detail pages call this card "Open
      // tasks"; a completed task listed under that heading is simply wrong, and the
      // History timeline below it already records the completion.
      tasks: { where: { status: { in: ['open', 'in_progress'] } }, orderBy: { dueDate: 'asc' } },
    },
  });
}

export async function getContact(id: string) {
  return db().contact.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, domain: true } },
      leads: { orderBy: { createdAt: 'desc' } },
      opportunities: {
        orderBy: { updatedAt: 'desc' },
        include: { stage: { select: { name: true } } },
      },
      noteEntries: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      // Open ones only, as getLead already did. The detail pages call this card "Open
      // tasks"; a completed task listed under that heading is simply wrong, and the
      // History timeline below it already records the completion.
      tasks: { where: { status: { in: ['open', 'in_progress'] } }, orderBy: { dueDate: 'asc' } },
    },
  });
}

export async function createCompany(input: CompanyInput) {
  const domain = normalizeDomain(input.domain);
  if (domain) {
    const existing = await db().company.findUnique({ where: { domain }, select: { id: true } });
    if (existing) return { created: false as const, id: existing.id };
  }
  const company = await db().company.create({
    // The matching key, kept in step with the name on every write — a company created
    // here and one created from a lead have to be findable as the same account.
    //
    // `source` is stamped because a null one is read as the seeder's, and the badge for
    // that says "never real" in amber. A company someone typed in is as real as it gets.
    data: { ...input, domain, source: INTERNAL_SOURCE, nameKey: normalizeCompanyName(input.name) },
    select: { id: true },
  });
  return { created: true as const, id: company.id };
}

export async function createContact(input: ContactInput) {
  const email = normalizeEmail(input.email);
  if (email) {
    const existing = await db().contact.findUnique({ where: { email }, select: { id: true } });
    if (existing) return { created: false as const, id: existing.id };
  }
  const contact = await db().contact.create({
    data: { ...input, email, source: INTERNAL_SOURCE },
    select: { id: true },
  });
  return { created: true as const, id: contact.id };
}

export async function addNote(input: NoteInput, authorEmail: string) {
  const note = await db().note.create({ data: { ...input, authorEmail }, select: { id: true } });
  await db().activity.create({
    data: {
      type: 'note_added',
      summary: input.body.slice(0, 140),
      actorEmail: authorEmail,
      leadId: input.leadId,
      contactId: input.contactId,
      companyId: input.companyId,
      opportunityId: input.opportunityId,
    },
  });
  return note;
}

export async function createTask(input: TaskInput, createdByEmail: string) {
  return db().task.create({
    data: {
      ...input,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdByEmail,
    },
    select: { id: true },
  });
}

export async function completeTask(id: string, actorEmail: string) {
  const task = await db().task.findUnique({
    where: { id },
    select: { status: true, title: true, leadId: true, contactId: true, companyId: true, opportunityId: true },
  });
  if (!task) return null;
  if (task.status === 'done') return { unchanged: true as const };

  await db().task.update({
    where: { id },
    data: { status: 'done', completedAt: new Date() },
  });
  await db().activity.create({
    data: {
      type: 'task_completed',
      summary: `Completed: ${task.title}`,
      actorEmail,
      leadId: task.leadId,
      contactId: task.contactId,
      companyId: task.companyId,
      opportunityId: task.opportunityId,
    },
  });
  return { unchanged: false as const };
}

/**
 * Reopens a completed task.
 *
 * completeTask() existed from the start with no inverse, so a task ticked off by mistake
 * stayed done for good. Clears completedAt as well as the status — a reopened task that
 * kept its completion date sorts and reports as though it were still finished.
 */
export async function reopenTask(id: string, actorEmail: string) {
  const task = await db().task.findUnique({
    where: { id },
    select: { status: true, title: true, leadId: true, contactId: true, companyId: true, opportunityId: true },
  });
  if (!task) return null;
  if (task.status !== 'done' && task.status !== 'cancelled') return { unchanged: true as const };

  await db().task.update({
    where: { id },
    data: { status: 'open', completedAt: null },
  });
  await db().activity.create({
    data: {
      type: 'status_changed',
      summary: `Reopened: ${task.title}`,
      actorEmail,
      leadId: task.leadId,
      contactId: task.contactId,
      companyId: task.companyId,
      opportunityId: task.opportunityId,
    },
  });

  return { reopened: true as const };
}

export async function updateCompany(id: string, input: z.infer<typeof companyPatch>) {
  const existing = await db().company.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  return db().company.update({ where: { id }, data: input, select: { id: true } });
}

export async function updateContact(id: string, input: z.infer<typeof contactPatch>) {
  const existing = await db().contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  return db().contact.update({ where: { id }, data: input, select: { id: true } });
}
