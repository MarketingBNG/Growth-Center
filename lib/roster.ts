import { prisma } from './prisma.ts';
import { canonicalEmail } from './roles.ts';

/**
 * Who is on the marketing team.
 *
 * ── D2 ────────────────────────────────────────────────────────────────────────────────
 *
 * The task-debt rule groups overdue tasks by assignee and raises one finding per person
 * above the floor. Against the live database that is eighteen people — Sanchit, Nidhi,
 * Madhu, Ravi, Prateek, Simran and a dozen more — of whom exactly one is on the marketing
 * team. The Growth Center's queue was showing a marketing team the whole firm's task debt,
 * and a queue that cannot be worked is abandoned inside a fortnight.
 *
 * Raising the floor does not fix it: lib/settings.ts records that a floor of 99,999 still
 * produced fifteen findings, because the debt is genuinely that large. The queue needs to
 * know whose debt is its business, and nothing in this application knew.
 *
 * ── Why it did not already exist ──────────────────────────────────────────────────────
 *
 * lib/roles.ts had a roster once and it was deliberately removed: access is by email
 * domain, and a hard-coded list of colleagues is a list that goes stale the first time
 * somebody joins. That reasoning holds for *access* and does not hold for *scope* — who
 * may sign in is a security question with a good domain-shaped answer, while whose work
 * this team is accountable for is an editable fact about an org chart.
 *
 * So it is a stored setting rather than a constant: empty until somebody fills it in, and
 * editable in Settings by anyone who can manage them.
 *
 * ── Empty means firm-wide, and says so ────────────────────────────────────────────────
 *
 * An unset roster must not silence a true finding. With no members the rules behave as
 * they did before and raise a configuration finding saying the roster is unset, which is
 * the pattern §5.2 asks for — an unowned rule is a configuration error shown to a person,
 * not a queue item quietly dropped.
 */
export const ROSTER_KEY = 'marketing.roster';

/**
 * The roster, canonicalised and deduplicated. Empty when nobody has set one.
 *
 * Canonical because these are typed into a text box by a person and compared against
 * addresses that arrived from Zoho, and `Gaurav@UsaIndiaCFO.com` matching nothing would
 * look exactly like a roster that was never saved.
 */
export async function marketingRoster(): Promise<string[]> {
  const client = prisma();
  if (!client) return [];

  const stored = await client.appSetting.findUnique({ where: { key: ROSTER_KEY } });
  if (!Array.isArray(stored?.value)) return [];

  // canonicalEmail returns null for an address outside the firm's domains, and one of
  // those on the roster would be a person who cannot sign in — dropped rather than kept
  // as a member nothing will ever match.
  const emails = (stored.value as unknown[])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => canonicalEmail(v))
    .filter((v): v is string => v !== null);

  return [...new Set(emails)].sort();
}

/** Splits addresses into the marketing team's and everybody else's, in one pass. An empty
 *  roster puts everyone in `rest`, which is what leaves the rules behaving as before. */
export function splitByRoster<T>(
  rows: T[],
  emailOf: (row: T) => string | null,
  roster: string[],
): { mine: T[]; rest: T[] } {
  const members = new Set(roster);
  const mine: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    const email = emailOf(row);
    const canonical = email ? canonicalEmail(email) : null;
    if (canonical && members.has(canonical)) mine.push(row);
    else rest.push(row);
  }
  return { mine, rest };
}
