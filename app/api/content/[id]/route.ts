import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import {
  ApprovalError,
  WorkflowError,
  contentPatch,
  setContentStatus,
  updateContent,
} from '@/lib/content';
import { CONTENT_STATUSES } from '@/lib/enums';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Two kinds of change, and they stay two kinds.
 *
 * A status move goes through `setContentStatus`, which is where §15.3's ordering and
 * §21.2's publish gate live. Everything else is a field edit and goes through
 * `updateContent`. A request may carry both — the edit form sends the whole record — and
 * then the fields are written first, deliberately: the publish gate hashes the piece as
 * it now stands, so editing the title and publishing in one submission is caught as an
 * edit after approval rather than slipping through on the version the approver read.
 */
const patchBody = contentPatch.extend({
  status: z.enum(CONTENT_STATUSES).optional(),
});

export const PATCH = route<unknown, Ctx>('content:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { status, ...fields } = await body(req, patchBody);

  try {
    const edited = Object.keys(fields).length
      ? await updateContent(id, fields, user.email)
      : null;
    if (Object.keys(fields).length && !edited) throw new HttpError(404, 'Content piece not found');

    if (!status) return edited ?? { id, changed: [], unchanged: true };

    const moved = await setContentStatus(id, status, user.email);
    if (!moved) throw new HttpError(404, 'Content piece not found');
    return { ...moved, changed: edited?.changed ?? [] };
  } catch (e) {
    // 422: publishing an unapproved piece is a refusal, not a fault. The message names
    // which of the two reasons it was, because "edited since approval" and "never
    // approved" call for different next steps.
    // Both are answers to the request rather than server faults: "this needs approving
    // first" and "this cannot skip a step" are things the caller can act on.
    if (e instanceof ApprovalError || e instanceof WorkflowError) throw new HttpError(422, e.message);
    throw e;
  }
});
