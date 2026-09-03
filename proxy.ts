import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Turns unauthenticated page requests away BEFORE anything renders.
 *
 * `app/(app)/layout.tsx` already redirects, but a layout redirect only stops navigation,
 * not rendering: the App Router renders layout and page concurrently, so the dashboard's
 * queries had already run and its output was flushed into the 307's body. An
 * unauthenticated `curl /` came back with revenue and pipeline figures in a 51KB body.
 * Proxy runs ahead of the route, so no page component executes and no query fires.
 *
 * This is a coarse gate — it only proves the session cookie is validly signed. The roster
 * check still lives in `currentUser()`, and the layout redirect stays as the authority on
 * *who* may enter. Do not remove it.
 */
export async function proxy(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    // Must match `cookies.sessionToken.name` in lib/auth.ts — the default name would
    // never be found, and every request would look signed out.
    cookieName: 'growth-center.session-token',
  });

  if (token) return NextResponse.next();

  const signin = new URL('/signin', req.url);
  // So the user lands where they were headed once they are in.
  signin.searchParams.set('from', req.nextUrl.pathname);
  return NextResponse.redirect(signin);
}

export const config = {
  /**
   * Page routes only.
   *
   * `/api/*` is deliberately excluded: those handlers gate themselves with
   * `requireUser()` and answer 401 JSON, which is what an API client needs — a redirect
   * to an HTML sign-in page would be a worse answer. `/api/public/v1/leads` also
   * authenticates with an X-API-Key rather than a session, so this must not touch it or
   * website form submissions would break.
   */
  matcher: ['/((?!api|signin|_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
