import { normalizeEmail, normalizeCompanyName, companyDomainFromEmail } from './dedupe.ts';
import { normalizePhone } from './phone.ts';

// §8.1 and G5.3: "Duplicate engine with a merge queue; show candidates, never 0."
//
// The CRM page has read "Duplicates merged: 0" since it was built, and the manual is
// right that the zero is not a fact about the data — nothing was ever scanning. Zoho's
// own merges arrive as records renamed "[MERGED] …", which this app already strips, so
// the only duplicates it could ever count were the ones it created itself through
// `findDuplicateLead` on the public form.
//
// Duplicates corrupt customer counts, CAC and every per-account average on that screen,
// which is why the manual puts this first in §8.
//
// The engine is deliberately a *candidate* generator, not a merger. Merging is
// destructive and irreversible, two records that look identical are sometimes a parent
// company and its subsidiary, and this data set has 27,575 leads in it. A queue somebody
// works through is slower than an automatic merge and it is the only version that cannot
// silently destroy an account.

/**
 * How the two records were matched, strongest first.
 *
 * The rule is stored on the candidate rather than recomputed at review time, so the
 * person deciding can see *why* the pair was proposed. "These share an email address" and
 * "these have similar names" call for quite different amounts of care.
 */
export const MATCH_RULES = ['email', 'phone', 'domain', 'name'] as const;
export type MatchRule = (typeof MATCH_RULES)[number];

/**
 * Confidence per rule, 0-100.
 *
 * An email address is a near-certain identity: two records sharing one are the same
 * person unless a family shares a mailbox. A normalised company name is the weakest — the
 * whole reason `Company.nameKey` is not unique is that two genuinely different accounts
 * can normalise alike, and this list inherits that caveat rather than forgetting it.
 */
export const RULE_CONFIDENCE: Record<MatchRule, number> = {
  email: 95,
  phone: 85,
  domain: 70,
  name: 55,
};

export const RULE_LABELS: Record<MatchRule, string> = {
  email: 'Same email address',
  phone: 'Same phone number',
  domain: 'Same company domain',
  name: 'Same company name',
};

export type Candidate = {
  entityType: 'lead' | 'company' | 'contact';
  /** Ordered, and the order is meaningful: `primaryId` is the record proposed to
   *  survive. See `chooseSurvivor`. */
  primaryId: string;
  duplicateId: string;
  rule: MatchRule;
  confidence: number;
  /** The value the two share, shown in the queue so the pair is checkable at a glance. */
  matchedOn: string;
};

/**
 * A stable key for one unordered pair.
 *
 * Unordered on purpose. The same two records can be proposed by two rules — a shared
 * email usually implies a shared domain — and without this the queue would carry the same
 * decision twice under two headings, which is how a reviewer learns to skim.
 */
export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

type Record_ = {
  id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  createdAt: Date;
  /** Anything that makes a record the better one to keep — activities, deals, notes. */
  weight?: number;
};

/**
 * Which of two records should survive a merge.
 *
 * Richness first, age second. The older record is the conventional survivor and it is the
 * wrong default here: this workspace re-imported its CRM, so the oldest row is often a
 * bare stub and the newer one carries the deals, the activity log and the corrected
 * spelling. Keeping the stub and discarding the history is the one outcome a merge must
 * never produce.
 *
 * Ties break on age, so the function is total and deterministic — a queue whose proposed
 * survivor changed between two page loads would be unreviewable.
 */
export function chooseSurvivor<T extends Record_>(a: T, b: T): [T, T] {
  const wa = a.weight ?? 0;
  const wb = b.weight ?? 0;
  if (wa !== wb) return wa > wb ? [a, b] : [b, a];
  if (a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt <= b.createdAt ? [a, b] : [b, a];
  }
  // Last resort: the id. Arbitrary, but stable, which is the property that matters.
  return a.id <= b.id ? [a, b] : [b, a];
}

/**
 * Groups records by a normalised key and emits every pair inside each group.
 *
 * Pairs rather than clusters. Three records sharing an address are three decisions, not
 * one: the reviewer may well judge two of them the same person and the third a colleague,
 * and a cluster interface offers no way to say that.
 *
 * Groups above `maxGroup` are dropped entirely. A normalisation bug that mapped 4,000
 * records onto one key would otherwise emit eight million pairs and fill the queue with a
 * single mistake — the cap makes that fail visibly, as a group that produced nothing,
 * rather than by exhausting the database.
 */
export function pairsByKey<T extends Record_>(
  records: T[],
  key: (r: T) => string | null,
  maxGroup = 25,
): [T, T][] {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const k = key(record);
    if (!k) continue;
    const list = groups.get(k) ?? [];
    list.push(record);
    groups.set(k, list);
  }

  const out: [T, T][] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    if (list.length > maxGroup) {
      console.warn(
        `[duplicates] "${k}" matches ${list.length} records — too many to be a duplicate. Skipped.`,
      );
      continue;
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
    }
  }
  return out;
}

/**
 * Every candidate pair among a set of records, strongest rule per pair.
 *
 * A pair matched by both email and domain is emitted once, under email — the stronger
 * claim. Emitting both would put the same decision in the queue twice.
 */
export function findCandidates(
  entityType: Candidate['entityType'],
  records: Record_[],
): Candidate[] {
  const best = new Map<string, Candidate>();

  const consider = (pairs: [Record_, Record_][], rule: MatchRule, value: (r: Record_) => string) => {
    for (const [a, b] of pairs) {
      const key = pairKey(a.id, b.id);
      const existing = best.get(key);
      const confidence = RULE_CONFIDENCE[rule];
      if (existing && existing.confidence >= confidence) continue;
      const [primary, duplicate] = chooseSurvivor(a, b);
      best.set(key, {
        entityType,
        primaryId: primary.id,
        duplicateId: duplicate.id,
        rule,
        confidence,
        matchedOn: value(a),
      });
    }
  };

  consider(
    pairsByKey(records, (r) => normalizeEmail(r.email)),
    'email',
    (r) => normalizeEmail(r.email) ?? '',
  );
  consider(
    pairsByKey(records, (r) => normalizePhone(r.phone)),
    'phone',
    (r) => normalizePhone(r.phone) ?? '',
  );
  consider(
    // Domain only where the mailbox is not a free provider. Grouping by "gmail.com" would
    // propose merging 19,734 leads into one another, which is the failure `maxGroup`
    // catches and this avoids raising in the first place.
    pairsByKey(records, (r) => companyDomainFromEmail(r.email)),
    'domain',
    (r) => companyDomainFromEmail(r.email) ?? '',
  );
  consider(
    pairsByKey(records, (r) => normalizeCompanyName(r.name)),
    'name',
    (r) => r.name ?? '',
  );

  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}
