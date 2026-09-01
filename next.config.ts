import type { NextConfig } from 'next';

const nextConfig: NextConfig = {

  // pg reaches for node:fs/net/tls at require time. Without this, webpack tries to
  // bundle it for every runtime and `next dev` returns 500 on every route with
  // "Can't resolve 'fs'" — the production build does not catch it.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],

  // typedRoutes is deliberately off: it types Link's href as a literal union, which the
  // config-driven nav array in lib/nav.ts cannot satisfy without casting every entry.
};

export default nextConfig;
