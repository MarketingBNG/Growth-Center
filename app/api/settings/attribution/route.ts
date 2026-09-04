import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { THRESHOLD_KEY, attributionThreshold, parseThreshold } from '@/lib/attribution';
import { TAGS, invalidate } from '@/lib/cache';

export const GET = route('settings:manage', async () => {
  return { threshold: await attributionThreshold() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({ threshold: z.number().int().min(0).max(100) }),
  );

  const before = await attributionThreshold();
  const threshold = parseThreshold(input.threshold);

  await db().appSetting.upsert({
    where: { key: THRESHOLD_KEY },
    create: { key: THRESHOLD_KEY, value: { percent: threshold } },
    update: { value: { percent: threshold } },
  });

  // The threshold decides whether the channel table carries a caveat, and that read is
  // cached alongside the metrics it qualifies.
  await invalidate(TAGS.settings);
  await invalidate(TAGS.metrics);

  // Recorded because this is a standard of evidence, not a display preference: lowering
  // it is how a channel ranking stops being qualified, and that should be attributable.
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.attribution',
      entityType: 'app_setting',
      entityId: THRESHOLD_KEY,
      detail: { from: before, to: threshold },
    },
  });

  return { threshold };
});
