import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { THRESHOLDS, THRESHOLD_KEYS, isThresholdKey } from '@/lib/thresholds';
import { saveThreshold, thresholds } from '@/lib/settings';
import { TAGS, invalidate } from '@/lib/cache';

// The numbers the rule library compares against. §20.5: "Thresholds live in a config
// table, editable by Shweta with the change recorded. They are never hard-coded and never
// decided by the model."
//
// One route for all of them rather than one per threshold. They are the same kind of
// object, saved from the same card, and a route per key would be ten copies of this.

export const GET = route('settings:manage', async () => {
  return { thresholds: await thresholds() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({
      key: z.enum(THRESHOLD_KEYS as [string, ...string[]]),
      value: z.number().int().min(0).max(1_000_000),
    }),
  );
  // Narrowed rather than cast: the zod enum is built from the same list, but a cast here
  // would keep compiling if that list and this parameter ever drifted apart.
  if (!isThresholdKey(input.key)) throw new Error(`Not a threshold: ${input.key}`);

  const before = (await thresholds())[input.key];
  const value = await saveThreshold(input.key, input.value);

  // Both tags: the thresholds read is tagged settings, and every rule finding and the
  // attribution card are computed against these and tagged metrics.
  await invalidate(TAGS.settings);
  await invalidate(TAGS.metrics);

  // §20.5 asks for the change to be recorded, and the reason is not bookkeeping: lowering
  // a threshold is how a finding stops being raised, and someone looking at a quiet page
  // is entitled to find out whether the problem went away or the bar moved.
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.threshold',
      entityType: 'app_setting',
      entityId: input.key,
      detail: { name: THRESHOLDS[input.key].label, from: before, to: value },
    },
  });

  return { key: input.key, value };
});
