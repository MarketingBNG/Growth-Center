// Access rules. Framework-free — no Prisma, no DOM — so tools/*.test.ts can import it
// directly and so it is safe to pull into a client component.
//
// There is no roster here any more. Who may sign in is decided by the email domain
// alone (ALLOWED_DOMAINS below), and the person's row in `app_user` is created on
// first sign-in. See lib/users.ts.

export type Role = 'partner' | 'controller' | 'manager' | 'member' | 'viewer';

/**
 * Both domains resolve to the same person: staff hold an address on each. The primary
 * is first — it is the one addresses are canonicalised to before they are stored, so
 * every ownerEmail in the database uses it.
 */
export const ALLOWED_DOMAINS = ['usaindiacfo.com', 'bngadvisors.com'];
export const PRIMARY_DOMAIN = ALLOWED_DOMAINS[0];

/**
 * The admin accounts. Not a permission tier — while ROLES_ENFORCED is false everybody
 * already has every permission. What this marks is the accounts that must always exist
 * and can never be revoked, so there is always an identity able to get back in.
 *
 * `name` pins the display name against whatever Google returns. Set it only for a shared
 * mailbox; a real person keeps the name they signed in with and can be renamed on the
 * Team page like anyone else.
 */
export const ADMINS: { email: string; name?: string }[] = [
  { email: 'marketing@usaindiacfo.com', name: 'Marketing' },
  { email: 'shweta@usaindiacfo.com' },
  { email: 'akshay@usaindiacfo.com' },
];

export const ADMIN_EMAILS = ADMINS.map((a) => a.email);

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const canonical = canonicalEmail(email);
  return !!canonical && ADMIN_EMAILS.includes(canonical);
}

/** The pinned display name for an admin mailbox, or null if it takes Google's. */
export function pinnedName(email: string | null | undefined): string | null {
  const canonical = email ? canonicalEmail(email) : null;
  if (!canonical) return null;
  return ADMINS.find((a) => a.email === canonical)?.name ?? null;
}

export type Permission =
  | 'growth:read'
  | 'crm:write'
  | 'pipeline:write'
  | 'campaigns:write'
  | 'content:write'
  | 'outreach:send'
  | 'integrations:manage'
  | 'apikeys:manage'
  | 'ai:run'
  | 'settings:manage';

/**
 * Tiered access is currently OFF: every signed-in user has every permission.
 *
 * POLICY is kept, and kept accurate, because turning tiers back on should be a one-line
 * change to can() rather than a rewrite. Do not delete it, and do not let it drift —
 * the Team page renders it as "what each role would be able to do".
 */
export const ROLES_ENFORCED = false;

const POLICY: Record<Permission, Role[]> = {
  'growth:read': ['partner', 'controller', 'manager', 'member', 'viewer'],
  'crm:write': ['partner', 'controller', 'manager', 'member'],
  'pipeline:write': ['partner', 'controller', 'manager', 'member'],
  'campaigns:write': ['partner', 'controller', 'manager'],
  'content:write': ['partner', 'controller', 'manager', 'member'],
  'outreach:send': ['partner', 'controller', 'manager'],
  'integrations:manage': ['partner', 'controller', 'manager'],
  'apikeys:manage': ['partner', 'controller'],
  'ai:run': ['partner', 'controller', 'manager'],
  'settings:manage': ['partner', 'controller'],
};

/** What POLICY says, ignoring whether it is currently enforced. Used by the Team page. */
export function wouldAllow(role: Role, permission: Permission): boolean {
  return POLICY[permission].includes(role);
}

/**
 * The live check, called by requirePermission() on every guarded route.
 *
 * While ROLES_ENFORCED is false this is a signed-in check and nothing more. The `role`
 * argument is still required so the call sites do not have to change when tiers return.
 */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (!ROLES_ENFORCED) return true;
  return wouldAllow(role, permission);
}

export const isFullAccess = (role: Role | null | undefined) =>
  !!role && (!ROLES_ENFORCED || role === 'partner' || role === 'controller');

/** Is this address allowed to sign in at all? The only gate there is. */
export function isAllowedEmail(inputEmail: string): boolean {
  return canonicalEmail(inputEmail) !== null;
}

/**
 * Reduces an address to the single form stored in `app_user.email`.
 *
 * Matches on the whole local part and nothing less. An earlier prefix-matching version
 * of this in Command Center once signed four non-roster accounts in as roster members,
 * so `shweta.extra@` must not resolve to `shweta@`.
 */
export function canonicalEmail(inputEmail: string): string | null {
  const email = (inputEmail || '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at <= 0 || email.indexOf('@', at + 1) !== -1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !ALLOWED_DOMAINS.includes(domain)) return null;

  return `${local}@${PRIMARY_DOMAIN}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Falls back to the local part when Google gives us no display name. */
export function nameFromEmail(email: string): string {
  const local = (email.split('@')[0] || '').replace(/[._-]+/g, ' ').trim();
  if (!local) return 'Unknown';
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
}
