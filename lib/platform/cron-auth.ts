import { NextResponse } from 'next/server';
import { cronCheck } from './cron-check.ts';
import { sync } from '../integrations/service.ts';
import { invalidate, type CacheTag } from './cache.ts';

/**
 * The auth check every `/api/cron/*` route opens with. There is no session behind a
 * scheduler invocation — Vercel calls these directly — so each authenticates with
 * CRON_SECRET as a bearer token instead of `route()`'s session check. The decision
 * itself, and why it fails closed, lives in cron-check.ts; this just turns the refusal
 * into the response a route hands back.
 *
 * Returns the refusal response, or `null` to proceed.
 */
export function cronGuard(req: Request): NextResponse | null {
  const refusal = cronCheck(req);
  return refusal ? NextResponse.json({ error: refusal.error }, { status: refusal.status }) : null;
}

/**
 * The handler for a provider that runs on its own schedule.
 *
 * Zoho CRM and PageSpeed are both out of the shared nightly run — each would spend the
 * whole 300s budget on its own — so each has a route of its own, and the two routes were
 * the same thirty lines down to the comment above the catch. What differs is the provider,
 * which caches its data invalidates, and the name in the log line.
 *
 * Why each provider is scheduled separately is an argument about that provider, and stays
 * in its own route file.
 *
 * `route` is the path segment, which is not always the provider id — /api/cron/zoho syncs
 * `zoho_crm` — and it is what the log line is keyed on, so a search for the failing cron
 * finds the same string it has always printed.
 */
export function providerCron(provider: string, route: string, tags: readonly CacheTag[]) {
  return async function GET(req: Request) {
    const refusal = cronGuard(req);
    if (refusal) return refusal;

    const started = Date.now();

    try {
      const result = await sync(provider, 30);
      await invalidate(...tags);

      return NextResponse.json({
        ok: true,
        ms: Date.now() - started,
        rows: result.rows,
        // False means the run was out of budget with records still to fetch. Not a
        // failure: it keeps its cursor and resumes next time. Reported so a pass that
        // never finishes is visible rather than looking like a clean import.
        done: result.done,
        detail: result.detail,
      });
    } catch (e) {
      const reason = (e as Error).message;
      // Logged as well as returned: the response goes to the scheduler, which nobody reads
      // unless something breaks. The log is where a failure is actually noticed.
      console.error(`[cron/${route}] failed:`, reason);
      return NextResponse.json(
        { ok: false, ms: Date.now() - started, error: reason },
        { status: 500 },
      );
    }
  };
}
