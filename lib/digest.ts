import { db } from './prisma.ts';
import { ADMIN_EMAILS } from './roles.ts';
import { insightHealth } from './insight-health.ts';
import { provider } from './email.ts';
import { cliqConfigured, renderCliqDigest, sendToCliq } from './cliq.ts';
import { thresholds } from './settings.ts';

// §20.6's daily digest: the findings waiting on a decision, ranked, in one message.
//
// ── Why it does not arrive every day ──────────────────────────────────────────────────
//
// A digest that lands every morning saying "nothing needs you" trains its reader to delete
// it unread, and the morning it matters looks identical in the inbox to the ninety that did
// not. So it is sent only when something is actually waiting, and the run records that it
// found nothing rather than sending to say so.
//
// The one exception is a decision sitting past its SLA. That is not "here is your news",
// it is "this has been waiting two days", and it is the message §21.6's own metric exists
// to make unnecessary.
//
// ── Why five ──────────────────────────────────────────────────────────────────────────
//
// §20.6 asks for a top five. Not a soft limit: a message listing twenty findings is a
// backlog report, and the reader picks the one they recognise rather than the one that
// matters. Everything else is counted in a line at the end, with a link to the page that
// holds all of it.

/** Worst first, then oldest first. Severity decides; age breaks the tie. */
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };

export type DigestItem = {
  id: string;
  title: string;
  severity: string;
  section: string | null;
  proposedAction: string | null;
  ageHours: number;
  /** Set when the finding has been waiting longer than the decision SLA. */
  overdue: boolean;
};

export type Digest = {
  items: DigestItem[];
  /** Findings awaiting a decision beyond the five listed. */
  others: number;
  overdue: number;
  /** §21.6's numbers, so the message says how the queue is being worked, not only what is in it. */
  health: Awaited<ReturnType<typeof insightHealth>>;
  slaHours: number;
};

export const TOP_N = 5;

export type PendingFinding = {
  id: string;
  title: string;
  severity: string | null;
  section: string | null;
  proposedAction: string | null;
  firstSeenAt: Date | null;
  createdAt: Date;
};

/**
 * Worst first, then longest waiting.
 *
 * Pure and exported so the ordering can be tested without a database, because the
 * ordering is the whole product here: the reader acts on the first item and skims the
 * rest, so an item in the wrong place is an item that does not get done.
 */
export function rankItems(pending: PendingFinding[], slaHours: number, now: Date): DigestItem[] {
  return pending
    .map((f) => {
      // firstSeenAt, not createdAt: a finding raised in July and re-raised every night
      // since has been waiting since July, and createdAt on the current row would report
      // it as this morning's. That distinction is the whole reason identity was built.
      const since = f.firstSeenAt ?? f.createdAt;
      const ageHours = Math.max(0, (now.getTime() - since.getTime()) / 3_600_000);
      return {
        id: f.id,
        title: f.title,
        severity: f.severity ?? 'medium',
        section: f.section,
        proposedAction: f.proposedAction,
        ageHours: Math.round(ageHours),
        overdue: ageHours > slaHours,
      };
    })
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        b.ageHours - a.ageHours,
    );
}

/**
 * What is waiting on a decision right now.
 *
 * `proposed` only. A finding somebody has already reviewed, assigned or dismissed is not
 * waiting on the reader of this message, and including it would make the digest a list of
 * work in progress — which is what the page is for.
 */
export async function buildDigest(now = new Date()): Promise<Digest> {
  const limits = await thresholds();
  const slaHours = limits['insights.approvalSlaHours'];

  const [pending, health] = await Promise.all([
    db().aiInsight.findMany({
      where: { status: 'proposed', ruleId: { not: null } },
      select: {
        id: true,
        title: true,
        severity: true,
        section: true,
        proposedAction: true,
        firstSeenAt: true,
        createdAt: true,
      },
    }),
    // The trailing month, matching what the executive pack reports. A digest quoting a
    // different window from the page it links to invites two people to compare figures
    // that were never the same measurement.
    insightHealth(new Date(now.getTime() - 30 * 86_400_000), now),
  ]);

  const ranked = rankItems(pending, slaHours, now);

  return {
    items: ranked.slice(0, TOP_N),
    others: Math.max(0, ranked.length - TOP_N),
    overdue: ranked.filter((f) => f.overdue).length,
    health,
    slaHours,
  };
}

/** Whether there is anything worth an email. */
export function worthSending(digest: Digest): boolean {
  return digest.items.length > 0;
}

const hours = (n: number) => (n < 48 ? `${n}h` : `${Math.round(n / 24)}d`);

/**
 * The message.
 *
 * Plain text, and that is a decision rather than a shortcut: this is read on a phone
 * between meetings, every client renders text identically, and there is nothing here a
 * layout would clarify. An HTML version would be a second thing to keep correct.
 */
export function renderDigest(digest: Digest, baseUrl: string): { subject: string; body: string } {
  const worst = digest.items[0];
  // The total waiting, not the number listed. Branching on `items.length` said "one
  // finding needs a decision" over a message whose body then counted twenty-four more,
  // because only five are ever listed.
  const waiting = digest.items.length + digest.others;
  const subject =
    waiting === 1
      ? `Growth Center — one finding needs a decision: ${worst.title}`
      : `Growth Center — ${waiting} findings need a decision`;

  const lines: string[] = [];

  if (digest.overdue > 0) {
    lines.push(
      `${digest.overdue} of these have been waiting longer than the ${digest.slaHours}-hour decision SLA.`,
      '',
    );
  }

  for (const [i, item] of digest.items.entries()) {
    lines.push(`${i + 1}. [${item.severity}] ${item.title}`);
    if (item.section) lines.push(`   Section: ${item.section} · waiting ${hours(item.ageHours)}`);
    else lines.push(`   Waiting ${hours(item.ageHours)}`);
    if (item.proposedAction) lines.push(`   Proposed: ${item.proposedAction}`);
    lines.push('');
  }

  if (digest.others > 0) {
    lines.push(`And ${digest.others} more waiting on a decision.`, '');
  }

  // The health numbers last. They describe how the queue is being worked rather than what
  // is in it, and putting them above the findings would make the reader scroll past a
  // process metric to reach the thing that needs them.
  const measured = digest.health.metrics.filter((m) => m.value !== null);
  if (measured.length > 0) {
    lines.push('Last 30 days:');
    for (const m of measured) {
      const value = m.format === 'percent' ? `${Math.round(m.value!)}%` : `${Math.round(m.value!)}h`;
      lines.push(`  ${m.label}: ${value}${m.basis ? ` (${m.basis})` : ''}`);
    }
    lines.push('');
  }

  lines.push(`Decide on these: ${baseUrl}/ai`);
  // Said in the message, because the alternative is somebody wondering whether the quiet
  // weeks meant nothing happened or the job stopped running.
  lines.push('');
  lines.push('This is sent only when something is waiting. No message means nothing was.');

  return { subject, body: lines.join('\n') };
}

export type DigestResult = {
  sent: number;
  skipped: 'nothing-waiting' | null;
  providerId: string;
  waiting: number;
  errors: string[];
  /** Whether the same digest also reached Zoho Cliq, and null when no webhook is set.
   *  Reported separately from `sent` because the two can genuinely disagree — mail has
   *  been refused for weeks while chat would have gone through. */
  cliq: 'sent' | 'failed' | null;
};

/**
 * Builds and sends. One message per recipient rather than one with everybody on it, so a
 * bounce for one address does not take the others with it.
 */
export async function sendDigest(baseUrl: string, now = new Date()): Promise<DigestResult> {
  const digest = await buildDigest(now);
  const p = provider();
  const waiting = digest.items.length + digest.others;

  if (!worthSending(digest)) {
    return { sent: 0, skipped: 'nothing-waiting', providerId: p.id, waiting, errors: [], cliq: null };
  }

  const { subject, body } = renderDigest(digest, baseUrl);
  const errors: string[] = [];
  let sent = 0;

  for (const to of ADMIN_EMAILS) {
    const result = await p.send({ to, subject, body });
    if (result.ok) sent += 1;
    else errors.push(`${to}: ${result.error}`);
  }

  // Chat as well as mail, and independent of it. Posted after the email loop rather than
  // inside it: Cliq is one channel the whole team reads, not one message per recipient,
  // and a mail failure must not stop it — that combination is the current situation
  // exactly, with SMTP refused for weeks and the findings reaching nobody.
  let cliq: DigestResult['cliq'] = null;
  if (cliqConfigured()) {
    const posted = await sendToCliq(renderCliqDigest(digest.items, digest.others, baseUrl));
    cliq = posted.ok ? 'sent' : 'failed';
    if (!posted.ok) errors.push(`cliq: ${posted.error}`);
  }

  return { sent, skipped: null, providerId: p.id, waiting, errors, cliq };
}
