// The people table. Replaces the hand-maintained roster that used to live in
// lib/roles.ts: rows appear here the first time someone signs in, so there is nothing
// to keep in sync and no way for an empty list to lock the team out.
//
// Server-only — imports Prisma. Client components take users as props.

import { db, prisma } from './prisma.ts';
import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  canonicalEmail,
  initialsOf,
  isAdmin,
  nameFromEmail,
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
  const name = admin ? ADMIN_NAME : (googleName || '').trim() || nameFromEmail(email);

  const row = await client.appUser.upsert({
    where: { email },
    create: {
      email,
      name,
      initials: initialsOf(name),
      displayRole: admin ? 'Admin' : null,
      lastSeenAt: new Date(),
    },
    // The admin's name is re-asserted; everyone else keeps whatever they already have.
    update: admin
      ? { name, initials: initialsOf(name), displayRole: 'Admin', active: true, lastSeenAt: new Date() }
      : { lastSeenAt: new Date() },
    select: { ...shape, active: true },
  });

  if (!row.active) return null;
  return toUser(row);
}

/**
 * Makes sure the admin row exists even if nobody has signed in with it yet, so the
 * account is present on the Team page from the start. Idempotent; safe to re-run.
 */
export async function ensureAdmin() {
  const client = prisma();
  if (!client) return null;

  return client.appUser.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      initials: initialsOf(ADMIN_NAME),
      displayRole: 'Admin',
      role: 'partner',
    },
    update: { name: ADMIN_NAME, initials: initialsOf(ADMIN_NAME), displayRole: 'Admin', active: true },
  });
}

/** Renames someone. The Team page uses this to fix the mangled names Google returns. */
export async function renameUser(inputEmail: string, newName: string) {
  const email = canonicalEmail(inputEmail);
  if (!email) throw new Error(`Not a valid company address: ${inputEmail}`);
  if (isAdmin(email)) throw new Error('The admin account name is fixed.');

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
  // The admin is the guaranteed way back in. Revoking it could leave nobody able to
  // restore anyone, since there is no tier above it.
  if (isAdmin(email) && !active) throw new Error('The admin account cannot be revoked.');
  return db().appUser.update({ where: { email }, data: { active } });
}
