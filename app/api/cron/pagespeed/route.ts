import { providerCron } from '@/lib/cron-auth';
import { TAGS } from '@/lib/cache';

/**
 * Weekly Core Web Vitals measurement. Scheduled in vercel.json.
 *
 * Separate from /api/cron/sync because PageSpeed cannot share it. One call takes 17-51
 * seconds — Google runs a full Lighthouse pass in a real browser — and a measured run
 * covered 22 pages in 237 seconds. `syncAll` runs providers one after another inside a
 * single 300s function, so leaving this in it would have spent the entire nightly budget
 * on PageSpeed and quietly stopped every other integration from syncing. The provider
 * declares `ownSchedule`, which is what keeps it out of that run and brings it here.
 *
 * Weekly rather than nightly because the data barely moves: the field half comes from
 * CrUX, which is a 28-day rolling average, so measuring it daily would mostly re-record
 * the same numbers at a minute of API time per page.
 *
 * Authenticated exactly as the nightly cron is — see cronGuard — for the same reason:
 * running openly when the variable is missing turns one forgotten env var into an
 * endpoint anyone can use to spend the API quota.
 */
export const maxDuration = 300;

// The SEO page reads both the metric rows and SeoPage.issues, and both have just been
// rewritten. Without invalidating them the page shows last week's figures until the TTL
// expires.
export const GET = providerCron('pagespeed', 'pagespeed', [
  TAGS.integrations,
  TAGS.metrics,
  TAGS.seo,
]);
