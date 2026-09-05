import { z } from 'zod';
import { db } from './prisma.ts';
import { PARTNER_TYPES, PARTNER_TYPE_LABELS, SILENT_DAYS, type PartnerRow, type PartnerType } from './referral-types.ts';

// §8.5: "Referral is our highest-trust channel and it has no home in any system today.
// What is not recorded is not followed up."
//
// The channel carries 217 leads. Which person sent each one is recorded, where it is
// recorded at all, as free text inside the CRM's source string — "Ref by NG", 137 leads.
// That string cannot be counted, cannot be thanked, and cannot be asked again.

// The vocabulary lives in lib/referral-types.ts, which imports nothing, so the registry
// table can read it without dragging the `pg` driver into the browser bundle. Re-exported
// here so a server caller has one place to import from.
export {
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  SILENT_DAYS,
  type PartnerType,
  type PartnerRow,
} from './referral-types.ts';

export const partnerInput = z.object({
  name: z.string().trim().min(1, 'A partner needs a name.'),
  partnerType: z.enum(PARTNER_TYPES).default('other'),
  email: z.string().trim().email().or(z.literal('')).optional(),
  phone: z.string().trim().optional(),
  company: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  ownerEmail: z.string().trim().email().or(z.literal('')).optional(),
  active: z.boolean().optional(),
});
export type PartnerInput = z.infer<typeof partnerInput>;

/** Recording a touch or a thank-you. Both are dates, both default to now. */
export const partnerEvent = z.object({
  event: z.enum(['touch', 'acknowledgement']),
  at: z.string().datetime().optional(),
});

const DAY = 86_400_000;


/**
 * The registry, with what each partner has actually produced.
 *
 * Customers won is counted through the deal rather than the lead: a referred lead that
 * became a deal that was won is one customer, and counting won leads instead would miss
 * every deal opened straight on the account — which is 90% of them here.
 */
export async function referralPartners(now = new Date()): Promise<PartnerRow[]> {
  const partners = await db().referralPartner.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      partnerType: true,
      company: true,
      email: true,
      ownerEmail: true,
      active: true,
      lastTouchAt: true,
      acknowledgementSentAt: true,
      createdAt: true,
      leads: { select: { createdAt: true } },
      opportunities: { select: { customer: { select: { id: true } } } },
    },
  });

  return partners.map((p) => {
    const since = p.lastTouchAt ?? p.createdAt;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY);
    const ack = p.acknowledgementSentAt;
    return {
      id: p.id,
      name: p.name,
      partnerType: p.partnerType as PartnerType,
      typeLabel: PARTNER_TYPE_LABELS[p.partnerType as PartnerType] ?? p.partnerType,
      company: p.company,
      email: p.email,
      ownerEmail: p.ownerEmail,
      active: p.active,
      leadsReferred: p.leads.length,
      customersWon: p.opportunities.filter((o) => o.customer !== null).length,
      lastTouchAt: p.lastTouchAt,
      daysSinceTouch: days,
      acknowledgementSentAt: ack,
      unacknowledged: p.leads.filter((l) => !ack || l.createdAt > ack).length,
      // An inactive partner is not silent; the relationship ended on purpose.
      silent: p.active && days > SILENT_DAYS,
    };
  });
}

export async function createPartner(input: PartnerInput) {
  return db().referralPartner.create({
    data: {
      name: input.name,
      partnerType: input.partnerType,
      // Empty strings become null. A partner with `email: ''` is not a partner with an
      // address, and storing one makes every "has contact details" query wrong.
      email: input.email || null,
      phone: input.phone || null,
      company: input.company || null,
      notes: input.notes || null,
      ownerEmail: input.ownerEmail || null,
      active: input.active ?? true,
    },
  });
}

export async function recordPartnerEvent(id: string, event: 'touch' | 'acknowledgement', at = new Date()) {
  return db().referralPartner.update({
    where: { id },
    data: event === 'touch' ? { lastTouchAt: at } : { acknowledgementSentAt: at, lastTouchAt: at },
  });
}
