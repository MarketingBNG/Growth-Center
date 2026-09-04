import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { registryInput, setSequenceRegistry } from '@/lib/outreach';

type Ctx = { params: Promise<{ id: string }> };

// The registry's descriptive half — purpose, segment, service line, sending domain.
// Gated on outreach:send rather than on approve, deliberately: filling in what a campaign
// is for is the work, and signing it off is the check. An admin does the first; only an
// owner does the second, in the sibling route.
export const PATCH = route<unknown, Ctx>('outreach:send', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, registryInput);
  const result = await setSequenceRegistry(id, input, user.email);
  if (!result) throw new HttpError(404, 'Sequence not found');
  return result;
});
