import { body, listQuery, paged, parseQuery, route } from '@/lib/api';
import { companyInput, createCompany, listCompanies } from '@/lib/crm';

export const GET = route('growth:read', async (_user, req) => {
  const q = parseQuery(req, listQuery);
  const { rows, total } = await listCompanies(q);
  return paged(rows, total, q);
});

export const POST = route('crm:write', async (_user, req) => {
  return createCompany(await body(req, companyInput));
});
