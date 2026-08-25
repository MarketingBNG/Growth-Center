import { encode } from 'next-auth/jwt';
import type { BrowserContext } from '@playwright/test';

// Mints a real NextAuth session cookie so tests can visit signed-in pages without
// driving Google's consent screen — which cannot be automated, and shouldn't be.
//
// This is not an auth bypass: the token is signed with the app's own NEXTAUTH_SECRET
// and carries an email that must still pass the roster check in lib/roles.ts on every
// request. Remove someone from the roster and this stops working for them too.

export const COOKIE_NAME = 'growth-center.session-token';

export async function sessionCookie(email: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set — cannot mint a test session.');

  return encode({
    token: { email, name: 'Karan', sub: email },
    secret,
    maxAge: 60 * 60,
  });
}

export async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const value = await sessionCookie(email);
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    { name: COOKIE_NAME, value, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}
