import { db } from './prisma.ts';
import { convert } from './currency.ts';
import { currencySettings } from './settings.ts';
import { num, rate } from './calc.ts';

// The budget envelope, and spend against it. §22.
//
// Akshay "sets the budget envelope by channel", once a quarter, "recorded with his
// identity". Shweta approves movements inside it, and receives "a single flag when
// Shweta approves something that breaches the envelope — one notification, never a
// queue".
//
// ── Why this is not Campaign.budget ───────────────────────────────────────────────────
//
// There was already a budget column, and budget pacing already computed against it. But
// it is the ad platform's own figure, imported by the sync: it is what Meta was told to
// spend. Pacing against it can only ever answer "is the platform doing as it was told",
// which is a question about the platform. §22's envelope is what the firm decided to
// spend, and nothing in the application recorded that.
//
// Both stay. The pacing gauge on /marketing still reads the platform's budgets and says
// so; this reads the firm's, and where an envelope exists it is the one that matters.
//
// ── The quarter is derived, not stored as a label ─────────────────────────────────────
//
// An envelope carries a start and an end date rather than "Q3 2026", so the same table
// holds a month, a quarter or a year without a second shape. Whose financial year a
// quarter belongs to is then never a question this code has to answer — the person
// setting the envelope picks the dates.

export type Envelope = {
  id: string;
  channelId: string;
  channelName: string;
  /** "YYYY-MM-DD". See the note on the schema for why these are not dates. */
  periodStart: string;
  periodEnd: string;
  /** As decided, in the currency it was decided in. */
  amount: number;
  currency: string;
  setByEmail: string;
  setAt: Date;
  note: string | null;
};

export type EnvelopeStatus = Envelope & {
  /** Spend in the period, converted to the reporting currency. */
  spent: number;
  /** The envelope in the reporting currency, so the two are comparable. Null where the
   *  workspace has no rate for the currency it was set in — and then every figure
   *  derived from it is null too, rather than a confident comparison between units. */
  envelopeInReporting: number | null;
  usedPercent: number | null;
  remaining: number | null;
  breached: boolean;
  reportingCurrency: string;
};

/**
 * The day a Date falls on, as "YYYY-MM-DD", read from LOCAL parts.
 *
 * `toISOString().slice(0, 10)` is the obvious alternative and it is wrong: it shifts the
 * day backwards in any timezone ahead of UTC, so "today" in Mumbai reads as yesterday
 * until half past five in the morning.
 */
export function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A date key back to a Date, at local midnight — for arithmetic, never for storage. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The quarter a date falls in.
 *
 * Calendar quarters. Nothing in the data suggests the firm reports on anything else, and
 * inventing a financial-year offset would be a guess with a plausible-looking result.
 */
export function quarterOf(date: Date): { periodStart: string; periodEnd: string; label: string } {
  const year = date.getFullYear();
  const q = Math.floor(date.getMonth() / 3);
  return {
    periodStart: dateKey(new Date(year, q * 3, 1)),
    // Exclusive end: the first day of the next quarter. A quarter ending on the 30th
    // would silently drop the 31st's spend in the quarters that have one.
    periodEnd: dateKey(new Date(q === 3 ? year + 1 : year, ((q + 1) % 4) * 3, 1)),
    label: `Q${q + 1} ${year}`,
  };
}

export async function envelopesFor(periodStart: string, periodEnd: string): Promise<EnvelopeStatus[]> {
  const [rows, fx] = await Promise.all([
    db().budgetEnvelope.findMany({
      where: { periodStart, periodEnd },
      include: { channel: { select: { id: true, name: true } } },
      orderBy: { channel: { name: 'asc' } },
    }),
    currencySettings(),
  ]);
  if (rows.length === 0) return [];

  // MarketingSpend.date is a real timestamp, so the period converts back to Dates here.
  // The conversion lives at the one boundary that needs it rather than in the stored
  // shape, which is the whole reason the stored shape is text.
  const from = parseDateKey(periodStart);
  const to = parseDateKey(periodEnd);

  // Spend reaches a channel through its campaign; there is no channel on a spend row.
  // Fetched as rows rather than grouped, because the grouping key lives on the joined
  // campaign and Prisma cannot group by it — and a query per channel would be a query
  // per row of the table this feeds.
  //
  // Every amount converts before it is added: this account is billed in more than one
  // currency, and a flat sum adds rupees to dollars.
  const perChannel = await db().marketingSpend.findMany({
    where: {
      date: { gte: from, lt: to },
      campaign: { is: { channelId: { in: rows.map((r) => r.channelId) } } },
    },
    select: { amount: true, currency: true, campaign: { select: { channelId: true } } },
  });

  const spentBy = new Map<string, number>();
  for (const row of perChannel) {
    const channelId = row.campaign?.channelId;
    if (!channelId) continue;
    const converted = convert(num(row.amount), row.currency, fx) ?? 0;
    spentBy.set(channelId, (spentBy.get(channelId) ?? 0) + converted);
  }

  return rows.map((r) => {
    const amount = num(r.amount);
    const envelopeInReporting = convert(amount, r.currency, fx);
    const spent = spentBy.get(r.channelId) ?? 0;

    return {
      id: r.id,
      channelId: r.channelId,
      channelName: r.channel.name,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      amount,
      currency: r.currency,
      setByEmail: r.setByEmail,
      setAt: r.setAt,
      note: r.note,
      spent,
      envelopeInReporting,
      usedPercent: envelopeInReporting === null ? null : rate(spent, envelopeInReporting),
      remaining: envelopeInReporting === null ? null : envelopeInReporting - spent,
      // Never true on an unconvertible envelope: a breach is a claim that someone has
      // overspent, and it must not rest on a comparison between two currencies.
      breached: envelopeInReporting !== null && spent > envelopeInReporting,
      reportingCurrency: fx.reporting,
    };
  });
}

export type EnvelopeInput = {
  channelId: string;
  /** "YYYY-MM-DD". */
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  note?: string | null;
};

export class BudgetError extends Error {}

/**
 * Sets or replaces one channel's envelope for a period.
 *
 * Every change is audited with the previous figure, because an envelope is an
 * instruction and "who raised this and when" is the question anyone will ask of an
 * overspend. §22 puts the identity on the record for the same reason.
 */
export async function setEnvelope(input: EnvelopeInput, actorEmail: string) {
  // String comparison is date comparison for this format, which is one of the reasons
  // it is the format.
  if (input.periodEnd <= input.periodStart) {
    throw new BudgetError('The period has to end after it starts.');
  }
  if (!(input.amount >= 0) || !Number.isFinite(input.amount)) {
    throw new BudgetError('An envelope has to be a number, and not a negative one.');
  }

  const channel = await db().channel.findUnique({
    where: { id: input.channelId },
    select: { id: true, name: true },
  });
  if (!channel) throw new BudgetError('No such channel.');

  const before = await db().budgetEnvelope.findUnique({
    where: {
      channelId_periodStart_periodEnd: {
        channelId: input.channelId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
    select: { amount: true, currency: true },
  });

  const saved = await db().budgetEnvelope.upsert({
    where: {
      channelId_periodStart_periodEnd: {
        channelId: input.channelId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
    create: { ...input, note: input.note ?? null, setByEmail: actorEmail },
    // setByEmail and setAt move to whoever changed it. The audit row below keeps the
    // history; the row itself answers "whose instruction is this now", which is the
    // question §22 cares about.
    update: {
      amount: input.amount,
      currency: input.currency,
      note: input.note ?? null,
      setByEmail: actorEmail,
      setAt: new Date(),
    },
  });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: 'budget.envelope',
      entityType: 'budget_envelope',
      entityId: saved.id,
      detail: {
        name: channel.name,
        period: `${input.periodStart} to ${input.periodEnd}`,
        from: before ? `${before.currency} ${num(before.amount)}` : null,
        to: `${input.currency} ${input.amount}`,
      },
    },
  });

  return saved;
}
