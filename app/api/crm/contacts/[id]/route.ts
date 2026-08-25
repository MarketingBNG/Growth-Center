import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { getContact } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<unknown, Ctx>('growth:read', async (_user, _req, ctx) => {
  const contact = await getContact((await ctx.params).id);
  if (!contact) throw new HttpError(404, 'Contact not found');
  return contact;
});
