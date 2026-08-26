import { HttpError } from '@/lib/auth';
import { body, route } from '@/lib/api';
import { getContact, updateContact, contactPatch } from '@/lib/crm';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<unknown, Ctx>('growth:read', async (_user, _req, ctx) => {
  const contact = await getContact((await ctx.params).id);
  if (!contact) throw new HttpError(404, 'Contact not found');
  return contact;
});

// Auto-created from an inbound lead, these arrive with whatever the form supplied — a
// mangled company name or a missing title had no way to be corrected.
export const PATCH = route<unknown, Ctx>('crm:write', async (_user, req, ctx) => {
  const { id } = await ctx.params;
  const updated = await updateContact(id, await body(req, contactPatch));
  if (!updated) throw new HttpError(404, 'Contact not found');
  return updated;
});
