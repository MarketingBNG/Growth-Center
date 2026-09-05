import { route } from '@/lib/api';
import { autofillContent } from '@/lib/content-autofill';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * §15.4, on demand as well as nightly.
 *
 * Behind `content:write` because it writes to the board. It only ever creates — nothing
 * it made is updated on a later run, so a piece somebody has retitled or briefed keeps
 * their work.
 */
export const POST = route('content:write', async () => {
  const result = await autofillContent();
  await invalidate(TAGS.metrics);
  return result;
});
