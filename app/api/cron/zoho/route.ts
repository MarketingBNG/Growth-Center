import { providerCron } from '@/lib/cron-auth';
import { TAGS } from '@/lib/cache';

/**
 * Nightly Zoho CRM import. Scheduled in vercel.json.
 *
 * Separate from /api/cron/sync because the CRM cannot share it. A full pass over this
 * org's records measured 182 seconds — 26,000 leads, 8,000 opportunities and their
 * contacts, accounts and activity, at 200 records a page — inside a single 300s function
 * that also had ten other providers to get through. It did not fit, and the way it failed
 * was the worst available: the function was killed mid-provider, so neither branch of the
 * try/catch in sync() ran, the integration row stayed on `syncing`, the card derived
 * "Sync stalled", and the sync_run row went on claiming to be running for ever. The
 * provider declares `ownSchedule`, which keeps it out of that run and brings it here.
 *
 * An hour before the shared cron rather than after it, because the two things that read
 * this data run at 02:30 and 03:00 — the packs and the digest — and a digest written from
 * yesterday's pipeline is worse than a late one.
 *
 * Authenticated exactly as the nightly cron is — see cronGuard — for the same reason:
 * running openly when the variable is missing turns one forgotten env var into an
 * endpoint anyone can use to hammer the CRM.
 */
export const maxDuration = 300;

// Every CRM page reads Lead, Contact and Opportunity, and the dashboard reads the metric
// rows. Both have just been rewritten; without invalidating them the screens show
// yesterday's pipeline until the TTL expires.
export const GET = providerCron('zoho_crm', 'zoho', [TAGS.integrations, TAGS.metrics]);
