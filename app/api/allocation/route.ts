import { z } from 'zod';
import { body, route } from '@/lib/api';
import { applyAllocation, previewAllocation } from '@/lib/allocation';

// Equal split of untouched leads. Two methods on purpose: GET works out the plan and
// changes nothing, POST runs it. Nothing here decides anything a GET did not already show,
// so the plan somebody approves on screen is the plan that executes.

const options = z.object({
  // Defaults live in lib/allocation.ts, not here — the planner is what has to be safe by
  // default, including when a cron or the AI calls it with no options at all.
  tolerance: z.number().min(0).max(2).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const GET = route('growth:read', async (_user, req) => {
  const url = new URL(req.url);
  const parsed = options.parse({
    tolerance: url.searchParams.has('tolerance') ? Number(url.searchParams.get('tolerance')) : undefined,
    limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
  });

  return previewAllocation(parsed);
});

export const POST = route('crm:write', async (user, req) => {
  const parsed = await body(req, options);
  const result = await applyAllocation(user.email, parsed);

  // Reported rather than thrown. A partial run is the normal outcome — the CRM can refuse
  // one record out of a hundred — and the caller needs both halves, not an error that
  // hides the ninety-nine that moved.
  return {
    moved: result.applied.length,
    failed: result.failed,
    target: result.plan.target,
    deferred: result.plan.deferred,
    after: result.plan.after,
  };
});
