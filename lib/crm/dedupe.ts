// Lead/contact matching rules. Pure and framework-free so tools/dedupe.test.ts can
// exercise them without a database.

// A consumer mailbox, not a company. An address here says nothing about who someone
// works for, so no Company is created from it — otherwise every Gmail enquirer is filed
// under an account called "gmail.com" alongside every other one.
//
// The regional variants matter more than the list's original US-centric set suggested:
// this business is Indian and its leads use yahoo.in, live.in, outlook.in, zohomail.in
// and rediff.com in numbers. Each was creating an account named after a mail provider
// and merging unrelated people into it.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'ymail.com', 'rocketmail.com',
  'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'yahoo.co.uk', 'yahoo.com.au', 'myyahoo.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.in',
  'outlook.com', 'outlook.in', 'live.com', 'live.in', 'live.co.uk', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'email.com', 'yandex.com', 'yandex.ru',
  'zoho.com', 'zohomail.com', 'zohomail.in',
  'rediffmail.com', 'rediff.com', 'sify.com', 'indiatimes.com',
]);

/**
 * Gmail treats dots and +tags as noise, so alice.smith+ads@gmail.com and
 * alicesmith@gmail.com are one person. Other providers do not, so only the +tag is
 * stripped there — dropping dots elsewhere would merge two different people.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  const email = (input ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;

  const at = email.lastIndexOf('@');
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain.includes('.')) return null;

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replaceAll('.', '');
  if (!local) return null;

  return `${local}@${domain}`;
}

/**
 * The company domain implied by an email, or null for a free provider. A lead from
 * alice@gmail.com tells us nothing about a company, and treating "gmail.com" as one
 * would merge every consumer lead into a single account.
 */
export function companyDomainFromEmail(input: string | null | undefined): string | null {
  const email = normalizeEmail(input);
  if (!email) return null;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return FREE_EMAIL_DOMAINS.has(domain) ? null : domain;
}

export const isFreeEmailDomain = (domain: string) => FREE_EMAIL_DOMAINS.has(domain.toLowerCase());

/** Strips scheme, www and path so "https://www.acme.com/pricing" matches "acme.com". */
export function normalizeDomain(input: string | null | undefined): string | null {
  let value = (input ?? '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0].split('?')[0].split(':')[0];
  return value.includes('.') ? value : null;
}

/** For matching company names: "Acme, Inc." and "acme inc" are the same account. */
export function normalizeCompanyName(input: string | null | undefined): string | null {
  const value = (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|pvt|private|plc|llp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value || null;
}

/**
 * Local parts that belong to a system rather than to a person.
 *
 * Read off this workspace's own contact table, not guessed. The Zoho Campaigns bounce
 * handler alone accounts for 24 contacts named
 * `campaign_913867674+zcreply.1164c300d20bf7a0d@zcsend.net` — VERP addresses, where the
 * `+` tag *is* the identity rather than an alias.
 */
const MACHINE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notices?|mailer-daemon|postmaster|bounce|campaign_|automated|alerts?|system)/i;

/**
 * Domains that only ever send. A contact here is a mailing list's return path.
 *
 * `zohoprojects.in` (736 contacts) is Zoho Projects' notification sender, imported by the
 * task sync. `zcsend.net` is Zoho Campaigns. The rest arrived as bulk senders in the mail
 * this firm receives.
 */
const MACHINE_DOMAIN = new Set([
  'zcsend.net',
  'zohoprojects.in',
  'zohodesk.com',
  'zohosupport.com',
  'mailer.zoho.com',
  'bounce.zoho.com',
]);

/**
 * Whether an address belongs to a machine.
 *
 * Used by the duplicate scanner and nowhere else. It deliberately does **not** filter the
 * records themselves: a Zoho notification contact is a real row that a real activity
 * hangs off, and deleting it would break the log. It is only excluded from *duplicate
 * proposals*, where it is worse than useless — the first live scan filled 200 of the 200
 * available queue slots with pairs of Zoho bounce addresses and pushed every genuine
 * duplicate off the page.
 *
 * The subdomain rule catches `mail.anthropic.com` and `e.zoom.us` without listing every
 * bulk sender the firm will ever hear from: `mail.`, `e.`, `email.` and `notifications.`
 * in front of a domain is the convention ESPs use.
 */
export function isMachineAddress(input: string | null | undefined): boolean {
  const email = (input ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (MACHINE_DOMAIN.has(domain)) return true;
  if (/^(mail|e|email|em|news|notifications?|reply|bounces?)\./.test(domain)) return true;
  return MACHINE_LOCAL.test(local);
}
