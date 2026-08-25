import { body, listQuery, paged, parseQuery, route } from '@/lib/api';
import { createLead, leadFilters, leadInput, listLeads } from '@/lib/leads';

export const GET = route('growth:read', async (_user, req) => {
  const q = parseQuery(req, listQuery.extend(leadFilters.shape));
  const { rows, total } = await listLeads(q, q);
  return paged(rows, total, q);
});

export const POST = route('crm:write', async (user, req) => {
  const input = await body(req, leadInput);
  return createLead(input, user.email);
});
