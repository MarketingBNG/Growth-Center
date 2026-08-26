import { HttpError } from '@/lib/auth';
import { body, route } from '@/lib/api';
import { getCompany, updateCompany, companyPatch } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<unknown, Ctx>('growth:read', async (_user, _req, ctx) => {
  const company = await getCompany((await ctx.params).id);
  if (!company) throw new HttpError(404, 'Company not found');
  return company;
});

// Auto-created from an inbound lead, these arrive with whatever the form supplied — a
// mangled company name or a missing title had no way to be corrected.
export const PATCH = route<unknown, Ctx>('crm:write', async (_user, req, ctx) => {
  const { id } = await ctx.params;
  const updated = await updateCompany(id, await body(req, companyPatch));
  if (!updated) throw new HttpError(404, 'Company not found');
  return updated;
});
