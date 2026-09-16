import type { NextAuthOptions, Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { can, isAllowedEmail, type Permission } from './roles.ts';
import { findUserByEmail, recordSignIn, type AppUser } from './users.ts';

export type CurrentUser = AppUser;

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      // No `hd` hint: it pins the chooser to a single domain, and bngadvisors.com
      // addresses are equally valid. The signIn callback is the boundary anyway.
      authorization: { params: { prompt: 'select_account' } },
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
    // The domain is the whole gate. Anyone with a company Google account gets in, and
    // recordSignIn creates their app_user row the first time. It returns null only for
    // an account that has been deactivated on the Team page.
    async signIn({ user }) {
      const email = user.email || '';
      if (!isAllowedEmail(email)) return false;
      return !!(await recordSignIn(email, user.name));
    },
    // Only identity is frozen into the token. Name, role and status are read from the
    // database per request by currentUser(), so a change on the Team page takes effect
    // inside a live session rather than at the next sign-in.
    async jwt({ token }) {
      return token;
    },
    async session({ session }) {
      return session;
    },
  },
};

export async function currentUser(): Promise<CurrentUser | null> {
  const session: Session | null = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  // Trust the database, not the session payload — the session is only proof of
  // identity. A deactivated account resolves to null here and is signed out everywhere.
  return findUserByEmail(email);
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
