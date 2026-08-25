import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { addNote, noteInput, singleParent } from '@/lib/crm';

export const POST = route('crm:write', async (user, req) => {
  const input = await body(req, noteInput);
  if (!singleParent(input)) {
    throw new HttpError(422, 'A note must name exactly one of lead, contact, company or opportunity');
  }
  return addNote(input, user.email);
});
