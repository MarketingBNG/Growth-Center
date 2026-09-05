import { route } from '@/lib/api';
import { createPartner, partnerInput, referralPartners } from '@/lib/referrals';

/** §8.5's registry. Reading it needs no special permission; adding to it is a CRM write. */
export const GET = route('growth:read', async () => referralPartners());

export const POST = route('crm:write', async (_user, req) => {
  const input = partnerInput.parse(await req.json());
  return createPartner(input);
});
