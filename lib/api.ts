import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError, requirePermission, requireUser, type CurrentUser } from './auth.ts';
import { IntegrationError } from './integrations/types.ts';
import { BudgetError } from './budget.ts';
import { ApprovalError, WorkflowError } from './content.ts';
import { MergeError } from './duplicate-queue.ts';
import { TransitionError } from './insight-actions.ts';
import { IneligibleError } from './outreach.ts';
import type { Permission } from './roles.ts';

/**
 * Domain rules that reject a write are a 422 wherever they are thrown — the caller asked
 * for something the business rules refuse, not something the server failed at. Registered
 * here so a route does not need a try/catch that exists only to restate that; six routes
 * used to.
 *
 * IntegrationError is deliberately not here: it maps to 502 below, because there the
 * vendor is refusing us rather than us refusing the caller. Four integration routes remap
 * it to 422 locally instead, because there the vendor is rejecting the caller's own input
 * — see the comment in each of those routes.
 */
const DOMAIN_422 = [BudgetError, ApprovalError, WorkflowError, MergeError, TransitionError, IneligibleError];

// The pure list/pagination contract lives in list-query.ts so it can be unit-tested
// without next/server. Re-exported here because 22 route handlers import it from
// '@/lib/api'.
export {
  listQuery,
  orderBy,
  paged,
  parseQuery,
  slice,
  type ListQuery,
  type Paged,
} from './list-query.ts';

export type ApiError = { error: string; detail?: unknown };

export function fail(status: number, error: string, detail?: unknown) {
  return NextResponse.json<ApiError>({ error, ...(detail ? { detail } : {}) }, { status });
}

/**
 * Wraps a route handler so every route reports errors the same way and no handler can
 * forget its authorization check — the permission is an argument, not a convention.
 */
export function route<T, C = unknown>(
  permission: Permission | null,
  handler: (user: CurrentUser, req: Request, ctx: C) => Promise<T>,
) {
  return async (req: Request, ctx: C) => {
    try {
      const user = permission ? await requirePermission(permission) : await requireUser();
      return NextResponse.json(await handler(user, req, ctx));
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      if (e instanceof z.ZodError) return fail(422, 'Invalid input', z.treeifyError(e));
      for (const Domain of DOMAIN_422) {
        if (e instanceof Domain) return fail(422, e.message);
      }
      // A vendor refusing a write is not our bug, and its message is the only thing that
      // tells the person what to do about it — "Unexpected error" would hide the one
      // sentence that matters, which is usually "reconnect the integration".
      if (e instanceof IntegrationError) return fail(502, e.message);
      const message = (e as Error).message ?? 'Unexpected error';
      if (message === 'DATABASE_URL is not set') {
        return fail(503, 'No database configured', 'Set DATABASE_URL and run npm run db:migrate.');
      }
      console.error('[api]', message);
      return fail(500, 'Unexpected error');
    }
  };
}

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  return schema.parse(raw);
}
