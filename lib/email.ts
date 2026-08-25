// Outreach sending, behind an interface.
//
// Nothing here sends mail today: the default provider writes to the console and records
// itself by name, so a message row can never imply an email was delivered when it was
// not. Adding a real provider is a new object plus one line in `provider()`.

export type Outgoing = { to: string; subject: string; body: string };
export type SendResult = { ok: true; providerId: string } | { ok: false; error: string };

export interface EmailProvider {
  readonly id: string;
  readonly sends: boolean;
  send(message: Outgoing): Promise<SendResult>;
}

/** The default. `sends: false` is the whole point — callers can check it and the UI can
 *  tell the truth about what happened. */
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

export function provider(): EmailProvider {
  // An SMTP provider slots in here once nodemailer is added; until then, being honest
  // beats a stub that claims success.
  return consoleProvider;
}

export function emailStatus() {
  const p = provider();
  return {
    providerId: p.id,
    sends: p.sends,
    smtpConfigured: smtpConfigured(),
    detail: p.sends
      ? 'Messages are delivered.'
      : smtpConfigured()
        ? 'SMTP credentials are set but no SMTP provider is wired up yet, so nothing is sent.'
        : 'No email provider is configured. Sends are logged, not delivered.',
  };
}
