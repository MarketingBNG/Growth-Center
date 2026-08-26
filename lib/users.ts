// The people table. Replaces the hand-maintained roster that used to live in
// lib/roles.ts: rows appear here the first time someone signs in, so there is nothing
// to keep in sync and no way for an empty list to lock the team out.
//
// Server-only — imports Prisma. Client components take users as props.

import { db, prisma } from './prisma.ts';
import { canonicalEmail, initialsOf, nameFromEmail, type Role } from './roles.ts';

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
 * Called from the signIn callback. Creates the row on a first sign-in and refreshes the
 * display name on later ones, so a name changed in Google Workspace follows through.
 *
 * Deliberately does NOT reactivate a deactivated account: someone who has been switched
 * off must not switch themselves back on by signing in again.
 */
export async function recordSignIn(inputEmail: string, googleName?: string | null): Promise<AppUser | null> {
  const email = canonicalEmail(inputEmail);
  if (!email) return null;

  const client = prisma();
  if (!client) return null;

  const name = (googleName || '').trim() || nameFromEmail(email);

  const row = await client.appUser.upsert({
    where: { email },
    create: { email, name, initials: initialsOf(name), lastSeenAt: new Date() },
    update: { name, initials: initialsOf(name), lastSeenAt: new Date() },
    select: { ...shape, active: true },
  });

  if (!row.active) return null;
  return toUser(row);
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
  return db().appUser.update({ where: { email }, data: { active } });
}
