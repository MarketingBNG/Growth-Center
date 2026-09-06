import { db } from './prisma.ts';

/**
 * Who must never receive a cold sequence.
 *
 * ── The control, and why it is a query rather than a list ─────────────────────────────
 *
 * §12.5: "Any cold list that has not passed the suppression check against clients and
 * referral partners." Appendix C makes it a refusal — "no cold send to a client or
 * referral partner" — and §7.7 says why it is not a metrics problem: a client receiving a
 * cold pitch is a relationship event, and the person who notices is the client.
 *
 * There was no such check. `Lead.isClient` and `Lead.isReferralPartner` were added for it
 * and nothing read them.
 *
 * A stored suppression list would be the obvious build and would be wrong here. It goes
 * stale the moment a prospect becomes a client, which is the exact case that matters —
 * the relationship changed and the sequence did not — so this is computed at the moment
 * it is asked instead. Three sources, because "client" is recorded three ways in this
 * workspace and any one of them alone would miss people:
 *
 *   the flags on Lead, which is where the CRM records it;
 *   the referral partner registry, which carries its own addresses;
 *   the contacts of companies that are customers, because a company being won does not
 *   go back and tick a flag on every person at it.
 *
 * Measured against the live database, only the third of those carries anything:
 * `isClient` is false on all 27,575 leads and no referral partner has an address on
 * record. Both columns were added for this control and never populated. The third source
 * alone finds 236 existing clients sitting on outbound lists — including one draft list
 * of a single prospect who is already a customer — which is why it reads all three rather
 * than the one the schema comment points at.
 *
 * ── What it does not do ───────────────────────────────────────────────────────────────
 *
 * It does not remove anybody. The app cannot stop Smartlead sending — that is the same
 * limit `displayStatus` works around — so this reports, refuses a sign-off, and names the
 * addresses. A control that silently dropped prospects would also be a control nobody
 * could audit.
 */

export type SuppressionHit = {
  email: string;
  /** Why this address is suppressed, in the words the reader needs. */
  reason: 'client' | 'referral partner';
  /** Where it was found, so a wrong hit can be traced to a record and fixed. */
  source: 'lead flag' | 'referral registry' | 'customer account';
};

/**
 * Purposes that are *supposed* to reach people the firm already knows.
 *
 * The gate is written this way round on purpose. Checking only sequences marked
 * `cold_acquisition` would have been the natural reading of §12.5, and against this
 * workspace it checks nothing at all: not one of the fifty sequences has a purpose set,
 * because the registry columns were added and never filled in.
 *
 * A control that silently does nothing is worse than no control, so an unset purpose is
 * treated as unknown and unknown is checked. Only an explicit declaration that a list is
 * meant for clients exempts it — which also gives whoever is annoyed by a false positive
 * something useful to do about it.
 */
const RELATIONSHIP_PURPOSES = new Set(['client_reminder', 'dormant_revival']);

export function needsSuppressionCheck(purpose: string | null | undefined): boolean {
  return !purpose || !RELATIONSHIP_PURPOSES.has(purpose);
}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Which of these addresses must not be sent to.
 *
 * Takes the addresses rather than a sequence id so the same check can run over a list
 * somebody is about to upload, not only over one already stored.
 */
export async function suppressed(emails: string[]): Promise<SuppressionHit[]> {
  const wanted = [...new Set(emails.map(normalise))].filter(Boolean);
  if (wanted.length === 0) return [];

  const [flagged, partners, customerContacts] = await Promise.all([
    db().lead.findMany({
      where: {
        email: { in: wanted, mode: 'insensitive' },
        OR: [{ isClient: true }, { isReferralPartner: true }],
      },
      select: { email: true, isClient: true, isReferralPartner: true },
    }),
    db().referralPartner.findMany({
      where: { email: { in: wanted, mode: 'insensitive' } },
      select: { email: true },
    }),
    // A company being won does not go back and tick a flag on everyone at it, and the
    // person most likely to be on an old cold list is exactly the one who became the
    // client.
    db().contact.findMany({
      where: {
        email: { in: wanted, mode: 'insensitive' },
        company: { is: { customer: { isNot: null } } },
      },
      select: { email: true },
    }),
  ]);

  // One hit per address, worst reason first: being a client is the more serious of the
  // two to cold-mail, and a list of two reasons for one person is not more useful.
  const hits = new Map<string, SuppressionHit>();
  const put = (email: string | null, hit: Omit<SuppressionHit, 'email'>) => {
    if (!email) return;
    const key = normalise(email);
    if (!hits.has(key)) hits.set(key, { email: key, ...hit });
  };

  for (const lead of flagged) {
    if (lead.isClient) put(lead.email, { reason: 'client', source: 'lead flag' });
  }
  for (const contact of customerContacts) {
    put(contact.email, { reason: 'client', source: 'customer account' });
  }
  for (const lead of flagged) {
    if (lead.isReferralPartner) put(lead.email, { reason: 'referral partner', source: 'lead flag' });
  }
  for (const partner of partners) {
    put(partner.email, { reason: 'referral partner', source: 'referral registry' });
  }

  return [...hits.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** The check over one stored sequence. Empty only where the sequence declares itself a
 *  list for people the firm already knows — a client reminder is *supposed* to reach
 *  clients, and flagging that would be noise the reader learns to click past. */
export async function suppressionCheck(sequenceId: string): Promise<SuppressionHit[]> {
  const sequence = await db().sequence.findUnique({
    where: { id: sequenceId },
    select: { purpose: true, prospects: { select: { email: true } } },
  });
  if (!sequence || !needsSuppressionCheck(sequence.purpose)) return [];
  return suppressed(sequence.prospects.map((p) => p.email));
}
