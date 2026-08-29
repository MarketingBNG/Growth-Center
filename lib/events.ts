// A small typed emitter, not a queue. Handlers run in-process, awaited, after the
// write that triggered them. That is enough for "lead qualified -> create a task";
// when something genuinely needs retries or a delay, replace dispatch()'s body with a
// real queue and the call sites do not change.

export type GrowthEvent =
  | { type: 'lead.created'; leadId: string; actorEmail: string | null }
  | { type: 'lead.qualified'; leadId: string; actorEmail: string | null }
  | { type: 'lead.converted'; leadId: string; opportunityId: string; actorEmail: string | null }
  | { type: 'opportunity.won'; opportunityId: string; actorEmail: string | null }
  | { type: 'opportunity.lost'; opportunityId: string; actorEmail: string | null }
  /** Moved back out of a won stage without being lost — someone corrected a mis-click. */
  | { type: 'opportunity.reopened'; opportunityId: string; actorEmail: string | null }
  | { type: 'integration.sync_failed'; provider: string; message: string };

type Handler = (event: GrowthEvent) => Promise<void>;

const handlers = new Map<GrowthEvent['type'], Handler[]>();

export function on<T extends GrowthEvent['type']>(
  type: T,
  handler: (event: Extract<GrowthEvent, { type: T }>) => Promise<void>,
) {
  const list = handlers.get(type) ?? [];
  list.push(handler as Handler);
  handlers.set(type, list);
}

let ready = false;

/**
 * Handlers register on the first dispatch rather than at server start.
 *
 * This used to live in instrumentation.ts, which Next evaluates for every runtime —
 * webpack then bundled the Postgres driver for the edge runtime and every route
 * returned 500 with "Can't resolve 'fs'". A dynamic import here keeps the driver on
 * the server, and means nothing has to remember to import the handlers.
 */
async function ensureRegistered(): Promise<void> {
  if (ready) return;
  ready = true;
  const { registerAutomations } = await import('./automation.ts');
  registerAutomations();
}

/**
 * A handler that throws must not fail the write that caused the event — a lead is
 * still created even if assigning its owner fails. Errors are logged, not propagated.
 */
export async function dispatch(event: GrowthEvent): Promise<void> {
  await ensureRegistered();
  for (const handler of handlers.get(event.type) ?? []) {
    try {
      await handler(event);
    } catch (e) {
      console.error(`[events] ${event.type} handler failed:`, (e as Error).message);
    }
  }
}
