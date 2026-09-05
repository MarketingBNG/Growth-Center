import { db } from './prisma.ts';
import { z } from 'zod';
import { Prisma } from './generated/prisma/client.ts';

// §6.2: "Add a Delivery capacity card: open consultations against capacity, fed by Zoho
// Projects or a monthly manual input from Simran/Kanishka."
//
// "Marketing must not create consultations the firm cannot serve. The ceiling belongs on
// the same screen as the accelerator."
//
// The manual marks its own source as unconfirmed — [A: source to confirm] — and it was
// right to. Zoho Projects is connected and holds 11,142 open delivery tasks across 103
// people, which measures *load* and says nothing about a ceiling. A ceiling is a
// judgement about how many new consultations senior delivery time can absorb this month,
// and nothing in any connected system holds it.
//
// So: load is measured, the ceiling is entered, and the card is explicit about which half
// is which. A card that inferred a ceiling from headcount would be an invented number on
// the one screen whose whole purpose is to stop marketing outrunning delivery.

/**
 * The manual monthly input, in AppSetting so changing it is not a deploy.
 *
 * Null until somebody enters one, and the card says so rather than defaulting. A default
 * ceiling is a number nobody chose being used to authorise spending.
 */
export const CAPACITY_KEY = 'delivery.capacity';

export const capacityInput = z.object({
  /** New consultations the firm can serve this month. */
  monthlyConsultations: z.number().int().min(0).max(10_000).nullable(),
  /** Who said so, and when. §22's audited config: a ceiling with no author is a ceiling
   *  nobody will defend when marketing wants to exceed it. */
  setByEmail: z.string().trim().email().nullable().optional(),
  setAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type CapacitySetting = z.infer<typeof capacityInput>;

const EMPTY: CapacitySetting = { monthlyConsultations: null, setByEmail: null, setAt: null, note: null };

export async function capacitySetting(): Promise<CapacitySetting> {
  const row = await db().appSetting.findUnique({ where: { key: CAPACITY_KEY } });
  // A stored value that no longer parses reads as "nobody has set one", which is the safe
  // direction: the card then says the ceiling is unknown rather than showing a shape from
  // an older release as though it were current.
  const parsed = capacityInput.safeParse(row?.value);
  return parsed.success ? parsed.data : EMPTY;
}

export async function setCapacity(input: CapacitySetting, actorEmail: string) {
  const value: CapacitySetting = {
    ...input,
    setByEmail: actorEmail,
    setAt: new Date().toISOString(),
  };
  await db().appSetting.upsert({
    where: { key: CAPACITY_KEY },
    create: { key: CAPACITY_KEY, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'capacity.set',
      entityType: 'app_setting',
      entityId: CAPACITY_KEY,
      detail: { monthlyConsultations: input.monthlyConsultations, note: input.note ?? null },
    },
  });

  return value;
}

export type Capacity = {
  /** What the firm said it can serve this month, or null if nobody has said. */
  ceiling: number | null;
  ceilingSetBy: string | null;
  ceilingSetAt: Date | null;
  /** New consultations booked into this month. The numerator the ceiling constrains. */
  booked: number;
  /** Open delivery work behind it, from Zoho Projects. Context rather than the measure:
   *  it is what the firm is already carrying, not what it can take on. */
  openDeliveryTasks: number;
  deliveryPeople: number;
  /** booked ÷ ceiling as a percentage, or null with no ceiling. */
  utilisation: number | null;
  /** True when this month's bookings have passed the stated ceiling. */
  over: boolean;
  month: { from: Date; to: Date };
};

/**
 * This month's load against the stated ceiling.
 *
 * "Consultations" are counted as deals opened in the month. This CRM records no
 * consultation event — that is the same gap that leaves CPQL without a numerator — so the
 * nearest real thing is a deal being opened, which is what a consultation produces when
 * it goes well. Named in the card rather than passed off as the manual's own definition.
 */
export async function deliveryCapacity(now = new Date()): Promise<Capacity> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);

  const [setting, booked, openTasks, people] = await Promise.all([
    capacitySetting(),
    db().opportunity.count({ where: { createdAt: { gte: from, lte: to } } }),
    db().task.count({
      where: { source: 'zoho_projects', status: { in: ['open', 'in_progress'] } },
    }),
    db().task
      .findMany({
        where: {
          source: 'zoho_projects',
          status: { in: ['open', 'in_progress'] },
          assigneeEmail: { not: null },
        },
        select: { assigneeEmail: true },
        distinct: ['assigneeEmail'],
      })
      .then((rows) => rows.length),
  ]);

  const ceiling = setting.monthlyConsultations;

  return {
    ceiling,
    ceilingSetBy: setting.setByEmail ?? null,
    ceilingSetAt: setting.setAt ? new Date(setting.setAt) : null,
    booked,
    openDeliveryTasks: openTasks,
    deliveryPeople: people,
    utilisation: ceiling === null || ceiling === 0 ? null : (booked / ceiling) * 100,
    over: ceiling !== null && ceiling > 0 && booked > ceiling,
    month: { from, to },
  };
}
