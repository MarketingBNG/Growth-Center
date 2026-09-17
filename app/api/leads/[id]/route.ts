import { z } from 'zod';
import { body, route, type Ctx } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import { getLead, setLeadOwner, setLeadStatus } from '@/lib/leads/leads';
import { LEAD_STATUSES } from '@/lib/shared/enums';
import { email } from '@/lib/platform/fields';

export const GET = route<unknown, Ctx>('growth:read', async (_user, _req, ctx) => {
  const lead = await getLead((await ctx.params).id);
  if (!lead) throw new HttpError(404, 'Lead not found');
  return lead;
});

const patch = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    ownerEmail: email().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.ownerEmail !== undefined, {
    message: 'Provide status or ownerEmail',
  });

export const PATCH = route<unknown, Ctx>('crm:write', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, patch);

  if (input.ownerEmail !== undefined) {
    if (!(await setLeadOwner(id, input.ownerEmail, user.email))) {
      throw new HttpError(404, 'Lead not found');
    }
  }
  if (input.status) {
    if (!(await setLeadStatus(id, input.status, user.email))) {
      throw new HttpError(404, 'Lead not found');
    }
  }
  return { ok: true };
});
