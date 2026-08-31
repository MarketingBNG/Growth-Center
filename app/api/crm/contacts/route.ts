import { z } from 'zod';
import { body, listQuery, paged, parseQuery, route } from '@/lib/api';
import { contactInput, createContact, listContacts } from '@/lib/crm';

export const GET = route('growth:read', async (_user, req) => {
  const q = parseQuery(req, listQuery.extend({ companyId: z.string().optional() }));
  const { rows, total } = await listContacts(q, { companyId: q.companyId });
  return paged(rows, total, q);
});

export const POST = route('crm:write', async (_user, req) => {
  return createContact(await body(req, contactInput));
});
