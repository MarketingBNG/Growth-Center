import { db } from './prisma.ts';

/**
 * When was each open deal last touched, and can that question be answered at all?
 *
 * ── D5 ────────────────────────────────────────────────────────────────────────────────
 *
 * The stale-deal rule reported 966 of 967 open deals stale and said so itself: "check
 * whether deal activity is syncing from Zoho at all before chasing owners". Manual v3.0
 * agreed and asked for the rule to be suppressed until a reconciliation passes, on the
 * grounds that chasing 966 owners over a data-engineering fault would cost the product
 * its credibility in a week.
 *
 * The reconciliation was run. What it found, against the live database:
 *
 *   29,498 activity rows are syncing from Zoho, so the sync is not the problem.
 *   25,184 of them attach to a Lead and 1,724 to an Opportunity. This firm logs calls
 *   against the lead and the contact, which is how its people work, not a defect.
 *   Of 967 open deals, 339 have activity on the deal, another 132 only on their contact,
 *   and 496 have none anywhere. Counting only the direct link called 132 deals untouched
 *   that were not.
 *
 * And then the part that settles it: widening the measure to include the contact moves
 * the count from 966 stale to 959. Eight open deals have been touched in thirty days by
 * any measure at all. The staleness is real. It was never mostly an artefact.
 *
 * So the rule is not suppressed for being wrong. It counts the contact's activity too,
 * because that is where the work is recorded, and it holds its tongue only when the CRM
 * sync is actually broken — which it is right now, `Zoho: invalid_code`, an expired
 * authorisation. That is the one condition under which "no activity" means "no data".
 *
 * ── One thing that is not evidence ────────────────────────────────────────────────────
 *
 * `Opportunity.updatedAt` looks like the obvious signal and is worthless as one. All
 * 8,087 opportunities carry an `updatedAt` inside the last week because the CRM sync
 * rewrites every row it re-imports. It records when this application last wrote, never
 * when a person last did.
 */

export type DealActivity = {
  /** Open deals, and how their most recent activity is reachable. */
  openDeals: number;
  /** Activity linked to the deal record itself. */
  direct: number;
  /** No activity on the deal, but some on its contact. The work this firm actually logs. */
  viaContactOnly: number;
  /** Nothing on the deal or its contact. */
  none: number;
  /** Last touch per open deal id, direct or through the contact. Absent means never. */
  lastTouch: Map<string, Date>;
  /**
   * Whether "no activity" can be read as "nobody worked it".
   *
   * False when the CRM sync is erroring or has never completed, because then an empty
   * activity history is a statement about the connection and not about the deal.
   */
  trustworthy: boolean;
  /** Why not, when it is not. Null when the answer can be trusted. */
  untrustworthyReason: string | null;
};

export async function dealActivity(): Promise<DealActivity> {
  const [open, crm] = await Promise.all([
    db().opportunity.findMany({
      where: { stage: { is: { isWon: false, isLost: false } } },
      select: {
        id: true,
        contactId: true,
        activities: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    db().integration.findUnique({
      where: { provider: 'zoho_crm' },
      select: { state: true, lastSyncAt: true, lastError: true },
    }),
  ]);

  // Deals are few enough to hold, and their contacts' activity is one grouped query
  // rather than one per deal.
  const contactIds = [...new Set(open.map((d) => d.contactId).filter((c): c is string => c !== null))];
  const contactTouch = new Map<string, Date>();
  if (contactIds.length > 0) {
    const grouped = await db().activity.groupBy({
      by: ['contactId'],
      where: { contactId: { in: contactIds } },
      _max: { createdAt: true },
    });
    for (const row of grouped) {
      if (row.contactId && row._max.createdAt) contactTouch.set(row.contactId, row._max.createdAt);
    }
  }

  const lastTouch = new Map<string, Date>();
  let direct = 0;
  let viaContactOnly = 0;

  for (const deal of open) {
    const own = deal.activities[0]?.createdAt ?? null;
    const contact = deal.contactId ? (contactTouch.get(deal.contactId) ?? null) : null;
    if (own) direct += 1;
    else if (contact) viaContactOnly += 1;

    const latest = own && contact ? (own > contact ? own : contact) : (own ?? contact);
    if (latest) lastTouch.set(deal.id, latest);
  }

  // Not "is it stale" but "is the connection healthy enough for silence to mean
  // anything". An erroring or never-completed CRM sync is the one case where it is not.
  const reason =
    !crm || crm.state === 'disconnected'
      ? 'Zoho CRM is not connected, so no activity history is reaching the application.'
      : crm.state === 'error' || crm.lastError !== null
        ? `Zoho CRM last sync failed (${crm.lastError ?? 'error'}), so an empty activity history describes the connection rather than the deal.`
        : !crm.lastSyncAt
          ? 'Zoho CRM has never completed a sync, so there is no activity history to read.'
          : null;

  return {
    openDeals: open.length,
    direct,
    viaContactOnly,
    none: open.length - direct - viaContactOnly,
    lastTouch,
    trustworthy: reason === null,
    untrustworthyReason: reason,
  };
}
