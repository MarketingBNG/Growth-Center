import { route } from '@/lib/api';
import { capacityInput, setCapacity } from '@/lib/capacity';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * §6.2's monthly ceiling.
 *
 * Behind `settings:manage`, which is the owner alone. The ceiling is what stops marketing
 * creating consultations the firm cannot serve, so raising it is a commitment of senior
 * delivery time — the same class of decision as a budget envelope, and gated the same way.
 */
export const PUT = route('settings:manage', async (user, req) => {
  const input = capacityInput.parse(await req.json());
  const saved = await setCapacity(input, user.email);
  await invalidate(TAGS.settings, TAGS.metrics);
  return saved;
});
