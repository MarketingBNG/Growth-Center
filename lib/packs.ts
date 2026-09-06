import { db } from './prisma.ts';
import { ADMIN_EMAILS } from './roles.ts';
import { buildReport, type Report, type ReportId, type Section } from './reports.ts';
import { rangeFor } from './range.ts';
import { provider } from './email.ts';
import { logDelivery } from './digest.ts';

/**
 * The two packs that have a standing time and a named reader. K7.
 *
 * §12.6 gives Shweta a Monday pack and Akshay a monthly scorecard on the first working
 * day. Both reports have existed and been buildable since §17 — what did not exist was
 * anything that sent them, so they were reports somebody had to remember to open, which
 * is the definition of a report nobody reads.
 *
 * ── Why the dates are computed and not configured ─────────────────────────────────────
 *
 * A cron cannot say "the first working day of the month": that is a rule about a calendar,
 * not an interval. So the cron runs daily and this decides whether today is one of the two
 * days — which also makes the decision a pure function with tests rather than a string in
 * vercel.json nobody can check.
 *
 * ── Timezone ──────────────────────────────────────────────────────────────────────────
 *
 * UTC throughout, and that is correct rather than convenient. The cron fires at 02:30 UTC,
 * which is 08:00 in the firm's timezone — §12.6's "Monday 08:00", and half an hour ahead
 * of the digest so the pack is the first thing in the inbox rather than the second. At
 * that hour the UTC calendar date and the IST one are the same day, so a pack computed on
 * UTC dates lands on the Monday and the first working day the reader means. That stops
 * being true if the run time ever moves past 18:30 UTC, which is the thing to check before
 * changing the schedule.
 */

export type PackId = 'weekly' | 'monthly';

export type Pack = {
  id: PackId;
  reportId: ReportId;
  /** What the message says it is. */
  title: string;
  /** How far back the report looks. */
  days: number;
};

export const PACKS: Record<PackId, Pack> = {
  weekly: {
    id: 'weekly',
    reportId: 'weekly-pack',
    title: 'The weekly pack',
    days: 7,
  },
  monthly: {
    id: 'monthly',
    reportId: 'executive',
    title: 'Monthly scorecard',
    // Thirty days rather than the calendar month: every metric function here takes a
    // trailing window, and a month-to-date figure sent on the first would cover one day.
    days: 30,
  },
};

/** Monday. */
export function isWeeklyDay(now: Date): boolean {
  return now.getUTCDay() === 1;
}

/**
 * The first Monday-to-Friday of the month.
 *
 * "First working day" and "the 1st" are the same date eight months in twelve and
 * materially different in the other four — a scorecard sent on Saturday the 1st is read on
 * Monday the 3rd along with everything else, which is the outcome this avoids. Public
 * holidays are not modelled: the firm works across two countries with different ones, and
 * a wrong holiday calendar would skip a month in silence.
 */
export function isFirstWorkingDay(now: Date): boolean {
  const day = now.getUTCDate();
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;

  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getUTCDay();
  // The 1st when it is a weekday; otherwise the 2nd (the 1st fell on a Sunday) or the 3rd
  // (it fell on a Saturday). No later date can be a month's first working day.
  if (day === 1) return true;
  if (day === 2) return firstOfMonth === 0;
  if (day === 3) return firstOfMonth === 6;
  return false;
}

/** Which packs today calls for. Both, on a Monday that is also the first working day. */
export function packsDue(now: Date): Pack[] {
  const due: Pack[] = [];
  if (isWeeklyDay(now)) due.push(PACKS.weekly);
  if (isFirstWorkingDay(now)) due.push(PACKS.monthly);
  return due;
}

/**
 * A report as plain text.
 *
 * Text for the reason lib/digest.ts gives: this is read on a phone between meetings, every
 * client renders it identically, and there is nothing here a layout would clarify. The PDF
 * already exists on the Reports page for anyone who wants to circulate one.
 */
export function renderPack(
  pack: Pack,
  report: Report,
  baseUrl: string,
): { subject: string; body: string } {
  // The weekly pack's report is called "The weekly pack", so naming both gives a subject
  // reading "The weekly pack — The weekly pack". One name when they are the same name.
  const heading = report.name === pack.title ? pack.title : `${pack.title} — ${report.name}`;
  const lines: string[] = [heading, ''];

  for (const section of report.sections) {
    lines.push(section.title, '─'.repeat(Math.min(section.title.length, 60)));
    lines.push(...renderSection(section));
    lines.push('');
  }

  // Trailing slash stripped here as well as at the caller. Every other renderer takes the
  // URL as given, and a link reading //reports is the kind of thing that survives review
  // because it still works.
  lines.push(`Open the Growth Center: ${baseUrl.replace(/\/$/, '')}/reports`);

  return { subject: heading, body: lines.join('\n') };
}

function renderSection(section: Section): string[] {
  if (section.kind === 'stats') {
    return section.rows.map((r) => `  ${r.label}: ${r.value}${r.hint ? ` (${r.hint})` : ''}`);
  }

  if (section.kind === 'table') {
    if (section.rows.length === 0) return ['  Nothing to report.'];
    // Widths from the content, so a table of short values does not sprawl — capped,
    // because one long campaign name should not push every other column off a phone.
    const widths = section.columns.map((column, i) =>
      Math.min(28, Math.max(column.length, ...section.rows.map((r) => (r[i] ?? '').length))),
    );
    const row = (cells: readonly string[]) =>
      '  ' +
      cells
        .map((cell, i) => (cell ?? '').slice(0, widths[i]).padEnd(widths[i]))
        .join('  ')
        .trimEnd();
    return [row(section.columns), ...section.rows.map((r) => row(r))];
  }

  // A section kind this renderer does not know renders as a line saying so, rather than
  // as nothing: a pack quietly missing a section reads as a pack with nothing to report.
  return ['  (not available in the emailed pack)'];
}

export type PackResult = {
  pack: PackId;
  sent: number;
  recipients: string[];
  errors: string[];
};

/**
 * Who reads which.
 *
 * From the accounts, like the digest's split. §12.6 names Shweta for the weekly pack and
 * Akshay for the monthly, and this workspace cannot tell those two people apart by name —
 * it can tell an approver from an admin. So the weekly goes to everybody working the queue
 * and the monthly to the approvers, which is the same distinction one level up.
 */
async function recipientsFor(pack: Pack): Promise<string[]> {
  const accounts = await db().appUser.findMany({
    where: { active: true },
    select: { email: true, role: true },
  });

  const chosen =
    pack.id === 'monthly'
      ? accounts.filter((a) => a.role === 'owner')
      : accounts.filter((a) => a.role === 'owner' || a.role === 'admin');

  // Never nobody. A scheduled pack that silently reaches no one is indistinguishable from
  // one that was never scheduled, which is the failure this whole file exists to fix.
  return chosen.length > 0 ? chosen.map((a) => a.email) : ADMIN_EMAILS;
}

export async function sendPack(
  pack: Pack,
  baseUrl: string,
  now = new Date(),
): Promise<PackResult> {
  const { current } = rangeFor(pack.days, now);
  const report = await buildReport(pack.reportId, current);
  const { subject, body } = renderPack(pack, report, baseUrl);

  const p = provider();
  const recipients = await recipientsFor(pack);
  const errors: string[] = [];
  let sent = 0;

  for (const to of recipients) {
    const result = await p.send({ to, subject, body });
    if (result.ok) sent += 1;
    else errors.push(`${to}: ${result.error}`);

    // §17's rule, the same one the digest follows: one row per recipient, so a pack that
    // reached two of three people shows which one was missed.
    await logDelivery({
      report: `${pack.id}_pack`,
      channel: 'email',
      recipient: to,
      subject,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
      itemCount: report.sections.length,
    });
  }

  return { pack: pack.id, sent, recipients, errors };
}
