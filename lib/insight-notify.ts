import { db } from './prisma.ts';
import { ADMIN_EMAILS } from './roles.ts';
import type { RaisedFinding } from './insight-rules.ts';

// §22: "One notification, never a queue."
//
// The Notification infrastructure has been complete for a while — a model, targeted
// delivery by address, read state, a bell in the header, an API — and it carried exactly
// one trigger, a failed sync. Everything else the app worked out, including every
// critical finding, sat on a page waiting for somebody to open it.
//
// ── Why one notification and not one per finding ──────────────────────────────────────
//
// A run can raise three critical findings and fifteen medium ones. Eighteen bell items is
// a queue, and the manual rules that out for a reason worth stating: a queue trains
// people to clear it. One notification per run, naming the count and the worst thing in
// it, is a thing somebody reads.
//
// ── Why only what is new ──────────────────────────────────────────────────────────────
//
// A finding still true this morning was still true yesterday, and notifying about it
// again every run is how a bell becomes noise. Only findings raised for the first time in
// this run count toward the notification, which is why generateInsights has to tell this
// module which those were — it is the only place that knows.

/** What is worth interrupting someone for. */
const NOTIFY_AT: RaisedFinding['severity'][] = ['critical', 'high'];

export type NewFinding = { severity: RaisedFinding['severity']; title: string };

/**
 * One notification for a run, or none.
 *
 * Sent to the addresses that can act on it rather than broadcast. `forEmail: null` — the
 * shape the sync-failure trigger uses — reaches everybody, which for a finding about an
 * unresolved template or a lead SLA means notifying people who cannot do anything about
 * it and cannot dismiss it either.
 */
export async function notifyNewFindings(findings: NewFinding[]): Promise<number> {
  const worth = findings.filter((f) => NOTIFY_AT.includes(f.severity));
  if (worth.length === 0) return 0;

  const critical = worth.filter((f) => f.severity === 'critical');
  const lead = critical[0] ?? worth[0];

  const title =
    worth.length === 1
      ? lead.title
      : `${worth.length} new findings need a decision`;

  // The body names the most serious one even when the title counts them, because a count
  // alone gives no reason to open it — and the worst item is the reason.
  const body =
    worth.length === 1
      ? undefined
      : critical.length > 0
        ? `${critical.length} critical, worst: ${lead.title}`
        : `Most serious: ${lead.title}`;

  // Critical is 'error' rather than 'warning': the four Critical rules in §20.5 are the
  // ones that block sending or publishing, and the bell should not use the same colour
  // for those as for a page with a poor click-through rate.
  const level = critical.length > 0 ? 'error' : 'warning';

  const recipients = ADMIN_EMAILS;
  await db().notification.createMany({
    data: recipients.map((forEmail) => ({
      title,
      body,
      level,
      href: '/ai',
      forEmail,
    })),
  });

  return recipients.length;
}
