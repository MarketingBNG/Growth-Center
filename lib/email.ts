// Outreach sending, behind an interface.
//
// Two providers: SMTP when it is configured, and a console provider that says out loud
// that it did not send. `sends: false` is the whole point of the second one — a message row
// can never imply an email was delivered when it was not.
//
// ── Why SMTP and not a sending API ────────────────────────────────────────────────────
//
// Provider-agnostic on purpose: host, port, user and password are all configuration, and
// nothing here knows or cares which server answers. That was written for Zoho Mail and is
// what makes moving to Gmail a change of four environment variables and no code — which
// is the move being made, Zoho having refused the mailbox for weeks with a 535 that needs
// an administrator to clear.
//
// Gmail: smtp.gmail.com:465, the address as SMTP_USER, and a 16-character **App
// Password** as SMTP_PASSWORD — an ordinary account password is refused with the same 535
// as a wrong one, which is precisely the ambiguity that made the Zoho failure expensive to
// diagnose. It needs 2-step verification switched on before one can be created.
//
// The original reasoning, still true of whichever server is used:
//
// A mail server the firm already runs means no new vendor, no new bill, and mail
// leaving the domain it claims to come from. A sending API would add a second vendor and a
// second deliverability reputation to warm up, for an internal digest read by three people.
//
// The trade is worth stating: SMTP gives no delivery webhooks, so a bounce is not visible
// here. For internal mail to known mailboxes that is an acceptable blind spot; it would not
// be for outreach to strangers, and outreach does not go through this.

import { createTransport, type Transporter } from 'nodemailer';

export type Outgoing = { to: string; subject: string; body: string };
export type SendResult = { ok: true; providerId: string } | { ok: false; error: string };

export interface EmailProvider {
  readonly id: string;
  readonly sends: boolean;
  send(message: Outgoing): Promise<SendResult>;
}

/** The default. `sends: false` lets callers and the UI tell the truth about what happened. */
const consoleProvider: EmailProvider = {
  id: 'console (nothing was actually sent)',
  sends: false,
  async send(message) {
    console.log(`[email:console] would send to ${message.to} — ${message.subject}`);
    return { ok: true, providerId: consoleProvider.id };
  },
};

const smtpConfigured = () =>
  !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASSWORD;

/**
 * Held between calls.
 *
 * A transport opens a connection pool, and building one per message would open a TCP
 * connection and a TLS handshake for every recipient of a digest.
 */
let transport: Transporter | null = null;

function smtpTransport(): Transporter {
  if (transport) return transport;

  // 465 with implicit TLS is the documented default for both Zoho and Gmail, and the
  // safer of the two: on 587 the connection starts in the clear and upgrades, and a
  // misconfigured server that declines the upgrade sends the credentials in plaintext.
  // `secure` is derived from the port rather than configured separately so the two can
  // never disagree.
  const port = Number(process.env.SMTP_PORT ?? 465);

  transport = createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    // A digest that cannot be sent must fail rather than hold a serverless function open
    // until the platform kills it, which reports as a crash rather than as a failed send.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

/**
 * The address mail is sent from.
 *
 * Falls back to the authenticating user, which is what both Zoho and Gmail expect: each
 * refuses a `From` the account does not own, so a mismatched `SMTP_FROM` produces a
 * rejection at send time rather than a quietly rewritten header. Gmail will accept an
 * alias here, but only one already verified under Settings → Accounts.
 */
function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || '';
}

const smtpProvider: EmailProvider = {
  get id() {
    return `smtp (${process.env.SMTP_HOST})`;
  },
  sends: true,
  async send(message) {
    try {
      const info = await smtpTransport().sendMail({
        from: fromAddress(),
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      return { ok: true, providerId: info.messageId ?? smtpProvider.id };
    } catch (e) {
      // Returned, not thrown. Every caller already handles a failed send by recording it;
      // throwing would take down the run that was sending a batch of them.
      return { ok: false, error: e instanceof Error ? e.message : 'The mail server refused the message.' };
    }
  },
};

export function provider(): EmailProvider {
  return smtpConfigured() ? smtpProvider : consoleProvider;
}

export function emailStatus() {
  const p = provider();
  return {
    providerId: p.id,
    sends: p.sends,
    smtpConfigured: smtpConfigured(),
    detail: p.sends
      ? `Messages are delivered over SMTP as ${fromAddress()}.`
      : 'No email provider is configured. Sends are logged, not delivered.',
  };
}

/**
 * Proves the credentials before anything is queued against them.
 *
 * Separate from a send on purpose: "the digest did not arrive" and "the password is wrong"
 * are different problems, and without this the first is the only symptom either produces.
 */
export async function verifyEmail(): Promise<{ ok: boolean; detail: string }> {
  if (!smtpConfigured()) {
    return { ok: false, detail: 'SMTP_HOST, SMTP_USER and SMTP_PASSWORD are not all set.' };
  }
  try {
    await smtpTransport().verify();
    return { ok: true, detail: `${process.env.SMTP_HOST} accepted the credentials.` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'The mail server refused the connection.' };
  }
}
