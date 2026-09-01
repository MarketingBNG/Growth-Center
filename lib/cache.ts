
/**
 * Read caching for the dashboard's server components.
 *
 * Every page here is a dynamic server component that awaits Prisma before it can return
 * any HTML, so a tab click costs one network round trip to Postgres per query — measured
 * at ~250ms each from outside the database's region, and pages issue two or three in
 * sequence. That is the whole of the one-to-two second wait between clicking a tab and
 * seeing it, in dev and on Vercel alike.
 *
 * The pages cannot be made static: most read `searchParams` for pagination, which opts
 * the route into dynamic rendering and makes a route-level `revalidate` a no-op. So the
 * caching goes one level down, around the reads themselves, where it applies whatever
 * the query string says.
 *
 * Only for reads whose staleness is invisible — daily metric snapshots, integration
 * states, currency settings. Anything a user edits and expects to see change on the next
 * screen (leads, deals, tasks) stays uncached and pays the round trip.
 */

/** Long enough to cover a burst of navigation, short enough that a stale figure never
 *  outlives the session that would notice it. */
const TTL = 300;

export const TAGS = {
  integrations: 'integrations',
  settings: 'settings',
  seo: 'seo',
  social: 'social',
  metrics: 'metrics',
} as const;

export type CacheTag = (typeof TAGS)[keyof typeof TAGS];

/**
 * Wrap a read so repeated calls within the TTL are served from Next's data cache.
 *
 * `key` must be unique per function, and the wrapped function's arguments are serialised
 * into the cache key by `unstable_cache` itself — so a helper taking a date range caches
 * per range rather than collapsing them all onto one entry.
 *
 * Writes invalidate by tag rather than waiting the TTL out: see `invalidate` below.
 */
/**
 * `next/cache` is loaded lazily rather than imported at the top of this file.
 *
 * The helpers in `lib/` are imported by the CLI tools too — `npm run smoke`, `db:verify`,
 * the sync scripts — which run under plain node with no Next runtime, where the bare
 * `next/cache` specifier does not resolve and a top-level import takes every one of them
 * down. Outside Next there is nothing to cache against anyway, so the wrapper falls back
 * to calling the function directly and the tools keep reading straight through.
 */
async function nextCache() {
  try {
    return await import('next/cache');
  } catch {
    return null;
  }
}

export function cached<A extends unknown[], R>(
  key: string,
  tags: CacheTag[],
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let wrapped: ((...args: A) => Promise<R>) | null = null;
  return async (...args: A) => {
    if (!wrapped) {
      const mod = await nextCache();
      wrapped = mod ? mod.unstable_cache(fn, [key], { tags, revalidate: TTL }) : fn;
    }
    return wrapped(...args);
  };
}

/**
 * Drop the cached reads a write has just invalidated.
 *
 * Call from server actions and route handlers only — `revalidateTag` throws during a
 * render. Connecting an integration, running a sync and saving currency settings all
 * change figures the user is looking at right now, so those must not wait out the TTL.
 */
export async function invalidate(...tags: CacheTag[]) {
  const mod = await nextCache();
  if (!mod) return;
  for (const tag of tags) mod.revalidateTag(tag);
}
