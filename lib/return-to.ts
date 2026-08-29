/**
 * Where to send someone after they sign in, from the `?from=` the middleware set.
 *
 * Its own module rather than part of lib/auth.ts, for the reason lib/kpi.ts is separate
 * from lib/metrics.ts: auth.ts builds the NextAuth config at import time, so nothing can
 * import it to test — and this is a validation boundary that has to be tested.
 *
 * Validated rather than trusted. It arrives in the URL, and `//evil.example` is a valid
 * pathname that a browser reads as protocol-relative — so a crafted sign-in link could
 * bounce a user who had just authenticated straight off the site. Only a single-slash
 * path is accepted; anything else falls back to the dashboard.
 */
export function safeReturnTo(from: string | undefined | null): string {
  if (!from || !from.startsWith('/')) return '/';
  // "//host" and "/\host" are both read as another origin.
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  // Signing in and landing back on the sign-in page is a loop, not a destination.
  if (from === '/signin' || from.startsWith('/signin?')) return '/';
  return from;
}
