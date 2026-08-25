// Lead/contact matching rules. Pure and framework-free so tools/dedupe.test.ts can
// exercise them without a database.

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com',
  'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'yandex.com', 'zoho.com', 'rediffmail.com',
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
