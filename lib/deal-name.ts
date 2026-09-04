// Reading this organisation's deal-naming convention.
//
// The CRM has no field saying whether a deal is new business or repeat work, and no field
// saying whether it is a one-off or a retainer — but the deal *name* carries both, and has
// for thousands of records. G1.4 and §8.2 of the Build and Operating Manual both ask for
// information that is already here, written into a string.
//
// The convention, from 8,072 live deals:
//
//     Mosaic Wellness INC_46_Apr'26_One Time
//     └ account ──────┘ └n┘ └period┘ └ engagement ┘
//
// `n` is a per-account engagement counter. Accounts show clean increasing runs — Chemco
// North America has 12, 13, 14; PI Health Sciences runs from 2 to 38 — so a deal numbered
// 1 is the first piece of work for that client and anything above it is repeat business.
// That is the new-versus-renewal split the manual wants, and it needs no change in Zoho.
//
// Three shapes exist and all three are handled:
//   5,635  the full pattern
//      94  an engagement suffix with no counter (some doubled: "…_One Time_One Time")
//   2,343  a plain account name with no convention at all
//
// Nothing here guesses. A name that does not carry the convention returns `unknown`, which
// is a different thing from `new` and must stay different: 2,343 deals is a quarter of the
// book, and quietly filing them as new business would recreate the exact overstatement
// G1.4 exists to remove.

export type EngagementType = 'one_time' | 'retainer';

/** Whether this is the first piece of work for the account, or a repeat. */
export type DealOrigin = 'new' | 'repeat' | 'unknown';

export type ParsedDealName = {
  /** The account portion, or null when the name carries no convention. */
  account: string | null;
  /** The per-account engagement counter. */
  sequenceNo: number | null;
  /** The period as the CRM writes it, e.g. "Apr'26". Kept verbatim, not parsed to a date:
   *  it is a label the sales team types, not a fact worth converting. */
  period: string | null;
  engagementType: EngagementType | null;
  origin: DealOrigin;
};

const EMPTY: ParsedDealName = {
  account: null,
  sequenceNo: null,
  period: null,
  engagementType: null,
  origin: 'unknown',
};

/**
 * The engagement suffix, allowing for the doubled form.
 *
 * Anchored to the end and applied repeatedly, because "…_One Time_One Time" is in the data
 * and a single match would leave a stray "_One Time" inside the account name.
 */
const SUFFIX = /_(One Time|Retainer)\s*$/i;

/** The counter and period, read from the right so an account name may contain underscores. */
const COUNTER = /_(\d{1,4})_([A-Za-z]{3}'\d{2})\s*$/;

function engagementOf(label: string): EngagementType {
  return /retainer/i.test(label) ? 'retainer' : 'one_time';
}

export function parseDealName(rawName: string | null | undefined): ParsedDealName {
  const name = (rawName ?? '').trim();
  if (!name) return EMPTY;

  let rest = name;
  let engagementType: EngagementType | null = null;

  // Strip every trailing engagement suffix. The first one found is the answer; the rest
  // are duplicates of it.
  for (let match = rest.match(SUFFIX); match; match = rest.match(SUFFIX)) {
    engagementType ??= engagementOf(match[1]);
    rest = rest.slice(0, match.index).trimEnd();
  }

  let sequenceNo: number | null = null;
  let period: string | null = null;
  const counter = rest.match(COUNTER);
  if (counter) {
    sequenceNo = Number(counter[1]);
    period = counter[2];
    rest = rest.slice(0, counter.index).trimEnd();
  }

  // An account is only reported when something was actually stripped from the name. A
  // plain name is the account, but reporting it here would suggest the convention was
  // found when it was not.
  const recognised = engagementType !== null || sequenceNo !== null;

  return {
    account: recognised && rest ? rest : null,
    sequenceNo,
    period,
    engagementType,
    origin: sequenceNo === null ? 'unknown' : sequenceNo <= 1 ? 'new' : 'repeat',
  };
}

export const ORIGIN_LABELS: Record<DealOrigin, string> = {
  new: 'New business',
  repeat: 'Repeat business',
  unknown: 'Unclassified',
};

export const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  one_time: 'One-off',
  retainer: 'Retainer',
};
