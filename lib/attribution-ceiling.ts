import { db } from './prisma.ts';
import { convert } from './currency.ts';
import { currencySettings } from './settings.ts';
import { num } from './calc.ts';
import { TAGS, cached } from './cache.ts';

/**
 * How much of the revenue could ever reach a channel — and how much never can.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────
 *
 * Manual v3.0 makes attribution the second of four priorities and says of the fix: "this
 * single automation moves deal coverage from 7.81% toward the lead's 99.62% without
 * anyone typing anything". The automation is the deal inheriting Channel and Campaign_ID
 * from its converting lead at conversion.
 *
 * Measured against the live database before building it, that automation gains nothing,
 * because it is already true. Of 927 deals that came from a lead, 880 have a lead
 * carrying a channel, and every one of those 880 deals already has a channel. The number
 * of deals the inheritance would newly attribute is zero.
 *
 * The gap is somewhere else entirely. 7,160 of 8,087 deals were never converted from a
 * lead — they were opened straight on an account or a contact — and of the 6,609 deals
 * with no channel, exactly one carries a source string of its own. The CRM does not
 * record where those deals came from. Not weakly, not in a field nobody reads: at all.
 *
 * ── What that means for the 70% threshold ─────────────────────────────────────────────
 *
 * Some of it can still be inferred. A deal whose contact or whose company arrived as a
 * channelled lead has evidence about it — weaker evidence, an inference about a
 * relationship rather than a record of a source, but real. Everything else has none.
 *
 * Taking every inference available, the ceiling on revenue attribution is 61.9%, against
 * a threshold of 70%. Which is to say: the refusal in §21.4 cannot be satisfied on this
 * history no matter what is built, and 38.1% of the money has no evidence of a channel
 * anywhere in the CRM.
 *
 * That is not an argument for lowering the threshold. It is an argument for knowing which
 * question is being asked — whether recent, properly captured revenue clears the bar is a
 * question with a future; whether eight thousand historical deals can be attributed
 * backwards is not. A product that refuses every scale decision forever, for a reason
 * nobody can act on, teaches its readers to route around the refusal.
 *
 * So the ceiling is computed and shown beside the coverage, and the shortfall is split
 * into the part that is a data-entry problem and the part that is not.
 */

export type AttributionCeiling = {
  /** Revenue in the window, reporting currency. */
  total: number;
  /** Reaching a channel today. */
  attributed: number;
  /**
   * Not attributed, but the deal's contact or company arrived as a channelled lead.
   * Recoverable by inference, at a confidence below a reported source.
   */
  inferable: number;
  /** Not attributed and nothing anywhere relates it to a channel. */
  unreachable: number;
  /** `(attributed + inferable) / total`, 0–100. Null with no revenue to judge. */
  ceilingPercent: number | null;
  currency: string;
};

async function readCeiling(from: Date, to: Date): Promise<AttributionCeiling> {
  const window = { gte: from, lte: to };

  const [rows, fx] = await Promise.all([
    db().revenueEntry.findMany({
      where: { date: window },
      select: {
        amount: true,
        currency: true,
        opportunity: {
          select: { channelId: true, contactId: true, companyId: true },
        },
      },
    }),
    currencySettings(),
  ]);

  // Which contacts and companies ever arrived as a channelled lead. Two sets rather than
  // a per-deal query: this runs over every revenue row in the window, and a lookup per
  // row would be thousands of round trips to answer one question.
  const contactIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const r of rows) {
    const o = r.opportunity;
    if (!o || o.channelId) continue;
    if (o.contactId) contactIds.add(o.contactId);
    if (o.companyId) companyIds.add(o.companyId);
  }

  const [byContact, byCompany] = await Promise.all([
    contactIds.size === 0
      ? Promise.resolve([])
      : db().lead.findMany({
          where: { contactId: { in: [...contactIds] }, channelId: { not: null } },
          select: { contactId: true },
          distinct: ['contactId'],
        }),
    companyIds.size === 0
      ? Promise.resolve([])
      : db().lead.findMany({
          where: { companyId: { in: [...companyIds] }, channelId: { not: null } },
          select: { companyId: true },
          distinct: ['companyId'],
        }),
    ]);

  const channelledContacts = new Set(byContact.map((l) => l.contactId));
  const channelledCompanies = new Set(byCompany.map((l) => l.companyId));

  let total = 0;
  let attributed = 0;
  let inferable = 0;

  for (const r of rows) {
    // Dropped from every bucket rather than counted as zero in one: a missing exchange
    // rate would otherwise read as a coverage shortfall.
    const amount = convert(num(r.amount), r.currency, fx);
    if (amount === null) continue;
    total += amount;

    const o = r.opportunity;
    if (o?.channelId) {
      attributed += amount;
      continue;
    }
    const related =
      (o?.contactId && channelledContacts.has(o.contactId)) ||
      (o?.companyId && channelledCompanies.has(o.companyId));
    if (related) inferable += amount;
  }

  return {
    total,
    attributed,
    inferable,
    unreachable: total - attributed - inferable,
    ceilingPercent: total === 0 ? null : ((attributed + inferable) / total) * 100,
    currency: fx.reporting,
  };
}

export const attributionCeiling = cached(
  'metrics:attribution-ceiling',
  [TAGS.metrics],
  readCeiling,
);
