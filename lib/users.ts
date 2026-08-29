// The people table. Replaces the hand-maintained roster that used to live in
// lib/roles.ts: rows appear here the first time someone signs in, so there is nothing
// to keep in sync and no way for an empty list to lock the team out.
//
// Server-only — imports Prisma. Client components take users as props.

import { db, prisma } from './prisma.ts';
import {
  ADMINS,
  canonicalEmail,
  initialsOf,
  isAdmin,
  nameFromEmail,
  pinnedName,
  type Role,
} from './roles.ts';

export type AppUser = {
  name: string;
  email: string;
  role: Role;
  initials: string;
  displayRole?: string;
  team?: string;
};

const shape = {
  name: true,
  email: true,
  role: true,
  initials: true,
  displayRole: true,
  team: true,
} as const;

type Row = { [K in keyof typeof shape]: unknown };

function toUser(row: Row): AppUser {
  return {
    name: row.name as string,
    email: row.email as string,
    role: row.role as Role,
    initials: row.initials as string,
    displayRole: (row.displayRole as string | null) ?? undefined,
    team: (row.team as string | null) ?? undefined,
  };
}

/**
 * Looks a signed-in person up. Returns null for an address outside the allowed domains
 * or for a deactivated account, which is how access is revoked — see setActive().
 */
export async function findUserByEmail(inputEmail: string): Promise<AppUser | null> {
  const email = canonicalEmail(inputEmail);
  if (!email) return null;

  const client = prisma();
  if (!client) return null;

  const row = await client.appUser.findUnique({ where: { email }, select: { ...shape, active: true } });
  if (!row || !row.active) return null;
  return toUser(row);
}

/**
 * Called from the signIn callback. Creates the row on a first sign-in; later sign-ins
 * only stamp lastSeenAt.
 *
 * The name is deliberately NOT refreshed from Google on every visit. Workspace display
 * names here are not clean — one real account comes back as
 * "Shweta Ramani_Digital Marketing" — so re-reading it each time would keep undoing any
 * correction. First value wins, and the admin account is fixed outright.
 *
 * Also deliberately does not reactivate a deactivated account: someone switched off must
 * not switch themselves back on by signing in again.
 */
export async function recordSignIn(inputEmail: string, googleName?: string | null): Promise<AppUser | null> {
  const email = canonicalEmail(inputEmail);
  if (!email) return null;

  const client = prisma();
  if (!client) return null;

  const admin = isAdmin(email);
  const pinned = pinnedName(email);
  const name = pinned || (googleName || '').trim() || nameFromEmail(email);

  const row = await client.appUser.upsert({
    where: { email },
    create: {
      email,
      name,
      initials: initialsOf(name),
      displayRole: admin ? 'Admin' : null,
      lastSeenAt: new Date(),
    },
    // A pinned name is re-asserted every time; everyone else, admin or not, keeps the
    // name already on the row so a correction is not undone at the next sign-in.
    update: {
      ...(pinned ? { name: pinned, initials: initialsOf(pinned) } : {}),
      ...(admin ? { displayRole: 'Admin', active: true } : {}),
      lastSeenAt: new Date(),
    },
    select: { ...shape, active: true },
  });

  if (!row.active) return null;
  return toUser(row);
}

/**
 * Makes sure every admin row exists even if nobody has signed in with it yet, so the
 * accounts are on the Team page from the start. Idempotent; safe to re-run.
 */
export async function ensureAdmins() {
  const client = prisma();
  if (!client) return [];

  return Promise.all(
    ADMINS.map(({ email, name }) => {
      const label = name ?? nameFromEmail(email);
      return client.appUser.upsert({
        where: { email },
        create: {
          email,
          name: label,
          initials: initialsOf(label),
          displayRole: 'Admin',
          role: 'partner',
        },
        // Only a pinned name is overwritten — a real person's own name is left alone.
        update: {
          ...(name ? { name, initials: initialsOf(name) } : {}),
          displayRole: 'Admin',
          active: true,
        },
      });
    }),
  );
}

/** Renames someone. The Team page uses this to fix the mangled names Google returns. */
export async function renameUser(inputEmail: string, newName: string) {
  const email = canonicalEmail(inputEmail);
  if (!email) throw new Error(`Not a valid company address: ${inputEmail}`);
  if (pinnedName(email)) throw new Error('That account is a shared mailbox; its name is fixed.');

  const name = newName.trim();
  if (!name) throw new Error('A name is required.');

  return db().appUser.update({ where: { email }, data: { name, initials: initialsOf(name) } });
}

/** Everyone who can own a lead, deal or task. */
export async function listAssignable(): Promise<AppUser[]> {
  const client = prisma();
  if (!client) return [];

  const rows = await client.appUser.findMany({
    where: { active: true },
    select: shape,
    orderBy: { name: 'asc' },
  });
  return rows.map(toUser);
}

/** The Team page, including deactivated accounts so they can be switched back on. */
export async function listUsers() {
  const client = prisma();
  if (!client) return [];

  return client.appUser.findMany({
    select: { ...shape, active: true, lastSeenAt: true, createdAt: true },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
}

/** Revokes (or restores) access. Preferred over deleting: ownerEmail columns across the
 *  schema are plain strings, so a deleted user leaves records pointing at nobody. */
export async function setActive(inputEmail: string, active: boolean) {
  const email = canonicalEmail(inputEmail);
  if (!email) throw new Error(`Not a valid company address: ${inputEmail}`);
  // The admins are the guaranteed way back in. Revoking one could leave nobody able to
  // restore anyone, since there is no tier above them.
  if (isAdmin(email) && !active) throw new Error('An admin account cannot be revoked.');
  return db().appUser.update({ where: { email }, data: { active } });
}

/**
 * Everyone a column of that name is actually set to, whether or not they have an account.
 *
 * The Owner and Assignee filters were built from the workspace roster alone. Almost every
 * record here is owned by someone in the source CRM with no account in this app — 1,009
 * tasks under one such name — so the filters offered a list nobody's records were under,
 * and the busiest people could not be selected at all.
 *
 * Named for the column rather than generic, so the caller cannot pass a table name into a
 * raw query. Prisma's groupBy validates the field for the model.
 */
export async function peopleOn(
  model: 'lead' | 'task',
  column: 'ownerEmail' | 'assigneeEmail',
): Promise<string[]> {
  const client = prisma();
  if (!client) return [];

  const rows =
    model === 'lead'
      ? await client.lead.groupBy({
          by: ['ownerEmail'],
          where: { ownerEmail: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { ownerEmail: 'desc' } },
          take: 100,
        })
      : await client.task.groupBy({
          by: ['assigneeEmail'],
          where: { assigneeEmail: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { assigneeEmail: 'desc' } },
          take: 100,
        });

  return rows
    .map((r) => (column === 'ownerEmail' ? (r as { ownerEmail: string | null }).ownerEmail : (r as { assigneeEmail: string | null }).assigneeEmail))
    .filter((v): v is string => !!v);
}

/** Roster first, so a name the workspace knows wins over the raw CRM string, then anyone
 *  else the data mentions. Keyed on the stored value, which is what a filter matches. */
export function personOptions(roster: AppUser[], seen: string[]) {
  const out = new Map<string, { value: string; label: string }>();
  for (const p of roster) out.set(p.email, { value: p.email, label: p.name });
  for (const s of seen) if (!out.has(s)) out.set(s, { value: s, label: s });
  return [...out.values()];
}
