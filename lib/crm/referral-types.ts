// §8.5's vocabulary, split out so a client component can read it.
//
// lib/referrals.ts imports lib/prisma, and lib/prisma imports the `pg` driver. A client
// component that reads a constant from there drags the whole driver into the browser
// bundle — which is exactly what happened here: PartnerRegistry.tsx imported
// PARTNER_TYPES and the production build died on "Can't resolve fs", after the type
// checker, the linter and the whole test suite had all passed.
//
// Client-safe means importing nothing. That is the rule this file follows and the reason
// it exists rather than being a section of the other one.

/** The five §8.5 names, plus an escape. */
export const PARTNER_TYPES = [
  'ca_firm',
  'law_firm',
  'incubator',
  'bank',
  'immigration_adviser',
  'other',
] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  ca_firm: 'CA firm',
  law_firm: 'Law firm',
  incubator: 'Incubator',
  bank: 'Bank',
  immigration_adviser: 'Immigration adviser',
  other: 'Other',
};

/**
 * How long a partner may go unspoken-to. §8's monthly rule names 60 days.
 *
 * Measured from `lastTouchAt`, and from `createdAt` where there has never been one — a
 * partner entered six months ago and never rung is exactly the case the registry exists
 * to surface, and measuring from a null would have excluded them.
 */
export const SILENT_DAYS = 60;

/** The shape the registry table renders. A type, so it is erased before the bundle. */
export type PartnerRow = {
  id: string;
  name: string;
  partnerType: PartnerType;
  typeLabel: string;
  company: string | null;
  email: string | null;
  ownerEmail: string | null;
  active: boolean;
  leadsReferred: number;
  customersWon: number;
  lastTouchAt: Date | null;
  daysSinceTouch: number;
  acknowledgementSentAt: Date | null;
  /** Referrals that arrived after the last thank-you. An unacknowledged referral is a
   *  debt, and a partner who sent three clients and was never thanked is the specific
   *  failure this table exists to make visible. */
  unacknowledged: number;
  silent: boolean;
};
