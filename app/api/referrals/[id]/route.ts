import { route } from '@/lib/api';
import { partnerEvent, recordPartnerEvent } from '@/lib/referrals';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Records a touch or an acknowledgement.
 *
 * An acknowledgement also counts as a touch, because sending a thank-you is speaking to
 * somebody — leaving the two independent would have a partner thanked this morning still
 * showing as silent for sixty days.
 */
export const POST = route<unknown, Ctx>('crm:write', async (_user, req, ctx) => {
  const { id } = await ctx.params;
  const { event, at } = partnerEvent.parse(await req.json());
  await recordPartnerEvent(id, event, at ? new Date(at) : undefined);
  return { id, event };
});
