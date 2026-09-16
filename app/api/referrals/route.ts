import { body, route } from '@/lib/platform/api';
import { createPartner, partnerInput, referralPartners } from '@/lib/crm/referrals';

/** §8.5's registry. Reading it needs no special permission; adding to it is a CRM write. */
export const GET = route('growth:read', async () => referralPartners());

export const POST = route('crm:write', async (_user, req) => {
  const input = await body(req, partnerInput);
  return createPartner(input);
});
