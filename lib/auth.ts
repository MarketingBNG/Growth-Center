import type { NextAuthOptions, Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { ALLOWED_DOMAINS, can, findUserByEmail, type Permission, type Role } from './roles.ts';

export type CurrentUser = {
  name: string;
  email: string;
  role: Role;
  initials: string;
  displayRole?: string;
  team?: string;
};

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      // `hd` only hints Google's account chooser. The signIn callback is the boundary.
      authorization: { params: { hd: 'usaindiacfo.com', prompt: 'select_account' } },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },

  // Distinct cookie names, because COOKIES IGNORE PORT NUMBERS. bng-command-center also
  // runs on localhost and also uses NextAuth, so with the default names the two apps
  // overwrite each other's session cookie. Growth Center then receives a token signed
  // with the other app's NEXTAUTH_SECRET and fails with JWT_SESSION_ERROR
  // ("decryption operation failed") — which looks like a broken login but is really a
  // cookie collision.
  cookies: {
    sessionToken: {
      name: 'growth-center.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
    callbackUrl: {
      name: 'growth-center.callback-url',
      options: { sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
    csrfToken: {
      name: 'growth-center.csrf-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
    state: {
      name: 'growth-center.state',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 900 },
    },
    pkceCodeVerifier: {
      name: 'growth-center.pkce.code_verifier',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 900 },
    },
  },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    async signIn({ user }) {
      const email = (user.email || '').toLowerCase();
      if (!ALLOWED_DOMAINS.includes(email.split('@')[1] || '')) return false;
      return !!findUserByEmail(email);
    },
    // Re-read the roster on every refresh rather than freezing the role at sign-in, so
    // a role change or a removal takes effect inside the session.
    async jwt({ token }) {
      const entry = findUserByEmail((token.email || '') as string);
      if (entry) {
        token.name = entry.name;
        token.role = entry.role;
        token.initials = entry.initials;
        token.displayRole = entry.displayRole ?? '';
        token.team = entry.team ?? '';
      } else {
        token.role = undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = (token.name as string) ?? '';
        Object.assign(session.user, {
          role: token.role,
          initials: token.initials,
          displayRole: token.displayRole,
          team: token.team,
        });
      }
      return session;
    },
  },
};

function toUser(session: Session | null): CurrentUser | null {
  const email = session?.user?.email;
  if (!email) return null;
  // Trust the roster, not the session payload — the session is only proof of identity.
  const entry = findUserByEmail(email);
  if (!entry) return null;
  return {
    name: entry.name,
    email: entry.email,
    role: entry.role,
    initials: entry.initials,
    displayRole: entry.displayRole,
    team: entry.team,
  };
}

export async function currentUser(): Promise<CurrentUser | null> {
  return toUser(await getServerSession(authOptions));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Server-side gate for every route handler and page. Throws; never returns null. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Not signed in');
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new HttpError(403, `Your role (${user.role}) cannot ${permission}`);
  }
  return user;
}
