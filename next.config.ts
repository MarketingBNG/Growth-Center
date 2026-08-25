import type { NextConfig } from 'next';

// typedRoutes is deliberately off: it types Link's href as a literal union, which the
// config-driven nav array in lib/nav.ts cannot satisfy without casting every entry.
const nextConfig: NextConfig = {};

export default nextConfig;
