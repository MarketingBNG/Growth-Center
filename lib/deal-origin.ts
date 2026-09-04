// Reading new-versus-repeat out of account history, for the deals whose names do not say.
//
// lib/deal-name.ts answers the question from the deal name, and answers it for 5,874 of
// 8,072 deals. The remaining 2,198 are named plainly — "TRAVEL GLIDERS LLC", "AASIM" —
// with no counter to read. But every one of them is linked to a company or a contact, so
// a second question is available: did this account already have a deal before this one?
//
// Measured against the 5,874 deals the names DO classify, that question gives the same
// answer 98.1% of the time (111 disagreements). It is a good rule, not a perfect one — an
// account that was merged, or a deal backdated after a later one was opened, will place
// first in a run it did not start.
//
// ── The cold start ────────────────────────────────────────────────────────────────────
//
// One thing makes the rule unsafe rather than merely imperfect. 928 deals carry
// createdAt = 7 Jul 2024, the day this workspace was first loaded from Zoho, and the next
// deal after them is three months later. For those, "no earlier deal" means "no earlier
// deal in a database that did not exist yet" — a twenty-year client and a first-time
// buyer look identical. There are only 11 named deals in that cohort, so the error cannot
// be measured either.
//
// So the cold-start day is excluded from being called `new`. A deal there stays
// `unknown`, which is the honest answer, and the same answer it has today. It can still
// be called `repeat`: a later deal on the account is positive evidence, and a deal that
// is not the account's first is not the account's first regardless of when the file
// starts.

import type { DealOrigin } from './deal-name.ts';

/**
 * The end of the first load from Zoho. Every deal stamped before this instant arrived in
 * that batch; the next one after it is three months later.
 *
 * All 928 carry the same stamp, 2024-07-07T17:00Z, so the boundary is set at the next
 * UTC midnight: past every row in the batch, and three months clear of the deal that
 * follows it. Do not move it back to the batch's own date — a boundary at 07-07T00:00Z
 * sits BEFORE the stamp and lets the entire cohort through as new business, which is the
 * bug this constant exists to prevent.
 *
 * Hard-coded rather than computed as min(createdAt): a derived floor would move the
 * moment the oldest deal is deleted, silently reclassifying a cohort. This is a fact
 * about this workspace's history, so it is written down as one.
 */
export const COLD_START = new Date('2024-07-08T00:00:00Z');

/** How a deal's origin was arrived at. Stored beside the origin so a reader can tell a
 *  fact read off the name from an inference drawn from history. */
export type OriginSource = 'name' | 'account-history';

export type HistoryInput = {
  id: string;
  /** Company, else contact. Deals with neither cannot be placed and are left alone. */
  accountKey: string | null;
  createdAt: Date;
  /** What the name said. Only `unknown` deals are candidates; the others are already
   *  answered by better evidence and are read here purely as history. */
  origin: DealOrigin;
};

export type HistoryVerdict = {
  id: string;
  origin: Exclude<DealOrigin, 'unknown'>;
  source: 'account-history';
};

/**
 * Classifies every `unknown` deal that account history can place.
 *
 * Ordering is by createdAt then id, matching the backfill's SQL so the two cannot
 * disagree about which deal came first when two share a timestamp — which 928 of them do.
 */
export function deriveFromHistory(deals: HistoryInput[]): HistoryVerdict[] {
  const byAccount = new Map<string, HistoryInput[]>();
  for (const deal of deals) {
    if (!deal.accountKey) continue;
    const run = byAccount.get(deal.accountKey);
    if (run) run.push(deal);
    else byAccount.set(deal.accountKey, [deal]);
  }

  const verdicts: HistoryVerdict[] = [];

  for (const run of byAccount.values()) {
    run.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));

    run.forEach((deal, index) => {
      if (deal.origin !== 'unknown') return;

      // Anything after the account's first deal is repeat work, whenever the file starts.
      if (index > 0) {
        verdicts.push({ id: deal.id, origin: 'repeat', source: 'account-history' });
        return;
      }

      // First in the run. Only meaningful if the run could have started earlier — see
      // the cold-start note above.
      if (deal.createdAt.getTime() >= COLD_START.getTime()) {
        verdicts.push({ id: deal.id, origin: 'new', source: 'account-history' });
      }
    });
  }

  return verdicts;
}

/**
 * Runs the rule against the whole opportunity table and writes what it settles.
 *
 * Shared by the sync and by tools/backfill-deal-origin.ts rather than implemented twice,
 * because two implementations of one rule is two answers to one question. Both hold a
 * Postgres connection but not the same kind, so the query goes through a callback.
 *
 * Reads every deal, not only the unknown ones: a deal the name already classified still
 * occupies a position in its account's run, and dropping it would make the deal after it
 * look like the first.
 *
 * Safe to re-run. It is a pure function of ids, account links and timestamps, so a second
 * pass over unchanged rows writes the same values.
 */
export async function applyHistoryOrigins(
  exec: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
): Promise<number> {
  const rows = await exec(
    `SELECT id, "companyId", "contactId", "createdAt", "dealOrigin", "originSource"
       FROM opportunity`,
    [],
  );

  const verdicts = deriveFromHistory(
    rows.map((row) => {
      const stored = (row.dealOrigin as string | null) ?? 'unknown';
      // A verdict this pass wrote last time is offered back to it as unknown, so the rule
      // re-derives its own conclusions from the current shape of the account rather than
      // treating them as settled. Only the name's answers are fixed.
      const inferred = row.originSource === 'account-history';
      return {
        id: row.id as string,
        accountKey:
          (row.companyId as string | null) ?? (row.contactId ? `c:${row.contactId}` : null),
        createdAt: new Date(row.createdAt as string),
        origin: (inferred ? 'unknown' : stored) as DealOrigin,
      };
    }),
  );

  // Clear last run's inferences before writing this run's, so a deal that has become
  // unclassifiable — its company unlinked, an earlier deal deleted — loses the verdict
  // instead of keeping a stale one. Only rows this pass wrote are cleared; the name's
  // answers are never touched.
  //
  // Not in a transaction with the write below, deliberately: the two statements go
  // through a caller-supplied connection that may already be inside one. If the process
  // dies between them, deals fall back to `unknown`, which understates new business —
  // the safe direction, and the direction the whole G1.4 split exists to protect.
  await exec(
    `UPDATE opportunity SET "dealOrigin" = 'unknown', "originSource" = NULL
      WHERE "originSource" = 'account-history'`,
    [],
  );

  const BATCH = 500;
  for (let i = 0; i < verdicts.length; i += BATCH) {
    const batch = verdicts.slice(i, i + BATCH);
    const values = batch.map((_, n) => `($${n * 2 + 1}, $${n * 2 + 2})`).join(', ');
    await exec(
      `UPDATE opportunity AS o
          SET "dealOrigin" = v.origin, "originSource" = 'account-history'
         FROM (VALUES ${values}) AS v(id, origin)
        WHERE o.id = v.id`,
      batch.flatMap((v) => [v.id, v.origin]),
    );
  }

  return verdicts.length;
}

export const ORIGIN_SOURCE_LABELS: Record<OriginSource, string> = {
  name: 'from the deal name',
  'account-history': 'inferred from account history',
};
