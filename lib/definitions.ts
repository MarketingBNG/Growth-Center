import type { Prisma } from './generated/prisma/client.ts';
import type { Range } from './range.ts';

/**
 * The three counting definitions the operating plan is written in, as one implementation
 * each.
 *
 * ── Why they are here and not inline ──────────────────────────────────────────────────
 *
 * K2 asks for Qualified Lead, Qualified Consultation and New Customer "as named, tested
 * metric functions". They were named nowhere: each was a Prisma `where` clause written
 * out at its call site, and "a consultation was held" was written out twice — once inside
 * `funnel` as `opportunities`, once inside `consultations` — as two identical queries
 * maintained by hand.
 *
 * Two copies of one definition is exactly the fault D11 was: `attributionHealth` was
 * shared and the *window* was not, and the product put two numbers for one idea on one
 * screen. These two agree today. Nothing was keeping them agreeing.
 *
 * So the predicate is the definition. A caller that wants the count writes the query; what
 * it may not do is decide what counts.
 *
 * ── What these definitions are worth ──────────────────────────────────────────────────
 *
 * Stated plainly, because the words are stronger than the data underneath them and every
 * one of these appears in a sentence someone will act on.
 *
 * `qualifiedLead` is the manual's word for a different event. Appendix B defines a
 * Qualified Lead as "consultation booked or partner call held", and this CRM records no
 * such event: `qualifiedAt` is stamped when a lead converts, so 1,028 of the 1,031 leads
 * carrying one are conversions. Counting it as the manual's qualified lead prints the
 * conversion figure twice under two names. The signal arrives with Zoho Bookings and not
 * before — see lib/glossary.ts, which says the same thing to the reader.
 *
 * `consultationHeld` is a deal being opened, which is the nearest real event and
 * under-counts every consultation that led nowhere. It is therefore a *lower* bound on
 * consultations and makes cost per consultation an *upper* bound. That asymmetry is worth
 * holding on to: the reported CPQL is the worst case, so a channel that looks affordable
 * on it really is.
 *
 * `newCustomer` is an account first won inside the window.
 */

/**
 * A lead the CRM has stamped as qualified.
 *
 * Not the manual's Qualified Lead. See the note above before putting this figure in a
 * sentence containing the word "qualified".
 */
export function qualifiedLead(range: Range, channelId?: string): Prisma.LeadWhereInput {
  return {
    createdAt: { gte: range.from, lte: range.to },
    qualifiedAt: { not: null },
    ...(channelId ? { channelId } : {}),
  };
}

/**
 * A lead that reached at least Semi-Qualified, or converted.
 *
 * The figure the dashboard actually reports, because it is the stage this team works:
 * 2,756 leads against the 3 the CRM calls qualified.
 */
export function semiQualifiedLead(range: Range, channelId?: string): Prisma.LeadWhereInput {
  return {
    createdAt: { gte: range.from, lte: range.to },
    ...(channelId ? { channelId } : {}),
    OR: [{ status: 'semi_qualified' }, { qualifiedAt: { not: null } }],
  };
}

/**
 * A consultation held, which this CRM records as a deal being opened.
 *
 * The CPQL denominator, and the same predicate `funnel` counts as `opportunities` — one
 * definition, so the funnel's step and the cost card cannot come to disagree about what a
 * consultation is.
 */
export function consultationHeld(range: Range, channelId?: string): Prisma.OpportunityWhereInput {
  return {
    createdAt: { gte: range.from, lte: range.to },
    ...(channelId ? { channelId } : {}),
  };
}

/**
 * An account won inside the window.
 *
 * Channel-scoped through the deal it was won on, lead first and deal second — the same
 * precedence `channelPerformance` and the revenue insert use, so a customer lands on the
 * channel their money did rather than on two different channels in two places.
 */
export function newCustomer(range: Range, channelId?: string): Prisma.CustomerWhereInput {
  const wonAt = { gte: range.from, lte: range.to };
  if (!channelId) return { wonAt };
  return {
    wonAt,
    OR: [
      { opportunity: { is: { lead: { is: { channelId } } } } },
      // The deal's own channel counts only where there is no lead. With both, the lead
      // wins — and a deal whose lead points elsewhere must not also land here, or one
      // customer is counted against two channels.
      { opportunity: { is: { lead: { is: null }, channelId } } },
    ],
  };
}
