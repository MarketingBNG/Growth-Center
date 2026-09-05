import { route } from '@/lib/api';
import { scanDuplicates } from '@/lib/duplicate-queue';
import { TAGS, invalidate } from '@/lib/cache';

/**
 * Runs a scan on demand. §8.1.
 *
 * Behind `crm:write` rather than a read permission: the scan writes rows into a queue
 * somebody then has to work through, so filling it is an action with a cost.
 *
 * The scan itself merges nothing, which is why it needs no approval — proposing is safe
 * and only the merge is destructive.
 */
export const POST = route('crm:write', async () => {
  const result = await scanDuplicates();
  await invalidate(TAGS.metrics);
  return result;
});
