import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { getCompany } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<unknown, Ctx>('growth:read', async (_user, _req, ctx) => {
  const company = await getCompany((await ctx.params).id);
  if (!company) throw new HttpError(404, 'Company not found');
  return company;
});
