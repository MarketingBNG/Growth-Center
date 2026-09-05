// Zoho Cliq — the chat the firm is already in.
//
// The digest has been blocked on SMTP for weeks: Zoho refuses the mailbox and the fix
// needs an administrator. Cliq needs neither a mailbox nor a mail server. It is an
// incoming webhook: a URL with a token in it that accepts a JSON POST, so there is no
// OAuth, no scope, and nothing to reconnect.
//
// It is deliberately an ADDITION rather than a replacement. Mail and chat are read at
// different times by different people, and a finding that needs a decision is better
// arriving in both than in whichever one somebody happens to have open. Either can be
// configured without the other; both are optional and the digest still runs with neither.
//
// **What this is not**: a delivery record. A webhook returns 200 when Cliq accepted the
// message, not when a person read it — the same limit SMTP has, and the reason §17's
// open tracking still needs an ESP.

/**
 * The webhook URL, token and all.
 *
 * Whole URL in one variable rather than a base plus a token, because that is exactly the
 * string Cliq hands over when the webhook is created — splitting it invites somebody to
 * reassemble it wrongly and debug a 404.
 */
const url = () => process.env.CLIQ_WEBHOOK_URL ?? '';

export const cliqConfigured = () => /^https:\/\/cliq\.zoho\.[a-z.]+\//i.test(url());

export type CliqResult = { ok: true } | { ok: false; error: string };

/**
 * Cliq's incoming-webhook payload.
 *
 * `text` is the whole contract for a plain message. Cliq also accepts a `card` and a
 * `bot` block, deliberately unused: a card renders differently across Cliq's clients and
 * this message has to be legible on a phone at 8am, which plain text always is.
 */
type Payload = { text: string };

/**
 * Posts one message. Never throws.
 *
 * Returned rather than thrown for the reason the mail provider gives: every caller is
 * already sending a batch and recording failures, and a throw here would take down the
 * run that was delivering the rest.
 */
export async function sendToCliq(text: string): Promise<CliqResult> {
  if (!cliqConfigured()) return { ok: false, error: 'CLIQ_WEBHOOK_URL is not set.' };
  if (!text.trim()) return { ok: false, error: 'Refusing to post an empty message.' };

  try {
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text } satisfies Payload),
      // Same bound the mail transport uses. A webhook that hangs must not hold a
      // serverless function open until the platform kills it, which reports as a crash
      // rather than as a failed post.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Cliq answers a revoked or mistyped token with 401/404 and an HTML body, so the
      // status is the useful part and the body is not worth surfacing.
      return { ok: false, error: `Cliq refused the message (${res.status}).` };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Cliq could not be reached.';
    return { ok: false, error: message };
  }
}

/**
 * The digest as a chat message.
 *
 * Not the email body reused. The email opens with context and closes with §21.6's health
 * numbers; a chat message that long is scrolled past. This is the count, the worst few,
 * and a link — everything else is on the page the link goes to.
 *
 * Markdown, which Cliq renders: *bold* with single asterisks, not double.
 */
export function renderCliqDigest(
  items: { severity: string; title: string; ageHours: number }[],
  others: number,
  baseUrl: string,
  max = 3,
): string {
  const total = items.length + others;
  const lines = [`*Growth Center* — ${total} finding${total === 1 ? '' : 's'} waiting on a decision`];

  for (const item of items.slice(0, max)) {
    // Age in whole days once it is past a day: "waiting 3d" is what a reader acts on,
    // and "waiting 76h" makes them do the division.
    const age = item.ageHours >= 24 ? `${Math.floor(item.ageHours / 24)}d` : `${Math.round(item.ageHours)}h`;
    lines.push(`• [${item.severity}] ${item.title} — waiting ${age}`);
  }

  const shown = Math.min(items.length, max);
  if (total > shown) lines.push(`…and ${total - shown} more`);

  lines.push(`${baseUrl.replace(/\/+$/, '')}/ai`);
  return lines.join('\n');
}
