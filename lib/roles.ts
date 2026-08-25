// The roster is the sign-in allow-list AND the permission source. Removing a line
// here revokes that person's access on their next request — same contract as
// bng-command-center's lib/roles.ts, which this deliberately mirrors.
//
// Framework-free so tools/*.test.ts can import it directly.

export type Role = 'partner' | 'controller' | 'manager' | 'member' | 'viewer';

export type RosterEntry = {
  name: string;
  email: string;
  role: Role;
  initials: string;
  displayRole?: string;
  team?: string;
};

export const ALLOWED_DOMAINS = ['usaindiacfo.com', 'bngadvisors.com'];

/** Growth Center's users: the Digital Marketing team, plus firm-wide full access. */
export const ROSTER: RosterEntry[] = [
  { name: 'Akshay Nahar', email: 'akshay@usaindiacfo.com', role: 'partner', initials: 'AN', displayRole: 'Partner' },
  { name: 'Nidhi Jain', email: 'nidhi.jain@usaindiacfo.com', role: 'controller', initials: 'NJ', displayRole: 'Strategic Associate & Controller' },
  { name: 'Shweta Ramani', email: 'shweta@usaindiacfo.com', role: 'manager', initials: 'SR', displayRole: 'Head — Digital Marketing', team: 'Digital Marketing' },
  { name: 'Karan', email: 'marketing@usaindiacfo.com', role: 'partner', initials: 'KR', displayRole: 'Developer', team: 'Automation' },
  { name: 'Dakshita Tanwar', email: 'dakshita@usaindiacfo.com', role: 'member', initials: 'DT', team: 'Digital Marketing' },
  { name: 'Tanisha Murkya', email: 'tanisha.murkya@usaindiacfo.com', role: 'member', initials: 'TM', team: 'Digital Marketing' },
  { name: 'Lakshya Dadhich', email: 'lakshya@usaindiacfo.com', role: 'member', initials: 'LD', team: 'Automation' },
];

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
 * One table, consulted by requirePermission(). Adding a role or a permission is an
 * edit here rather than a hunt for `role === 'manager'` across the route handlers.
 */
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

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return POLICY[permission].includes(role);
}

export const isFullAccess = (role: Role | null | undefined) =>
  role === 'partner' || role === 'controller';

/**
 * Roster lookup. Treats bngadvisors.com and usaindiacfo.com as the same address
 * because staff have both, but does NOT guess beyond that — no local-part prefix
 * matching, which in Command Center once signed four non-roster accounts in as
 * roster members.
 */
export function findUserByEmail(inputEmail: string): RosterEntry | null {
  const email = (inputEmail || '').trim().toLowerCase();
  if (!email.includes('@')) return null;

  const [local, domain] = email.split('@');
  if (!ALLOWED_DOMAINS.includes(domain)) return null;

  return ROSTER.find((e) => e.email.split('@')[0] === local) ?? null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Everyone who can own a lead, deal or task. Viewers are excluded. */
export const ASSIGNABLE = ROSTER.filter((e) => e.role !== 'viewer');
