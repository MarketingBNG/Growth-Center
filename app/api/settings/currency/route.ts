import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { CURRENCIES, currencySettings, saveCurrencySettings } from '@/lib/settings';

const codes = CURRENCIES.map((c) => c.code) as [string, ...string[]];

export const GET = route('settings:manage', async () => {
  return { currency: await currencySettings() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({
      reporting: z.enum(codes),
      // Units of the currency per one unit of the reporting currency. Positive and finite
      // — a zero rate divides every converted figure into infinity.
      rates: z.record(z.enum(codes), z.number().positive().finite()),
    }),
  );

  const currency = await saveCurrencySettings(input);
  await db().auditEvent.create({
    data: {
      actorEmail: user.email,
      action: 'settings.currency',
      entityType: 'app_setting',
      entityId: 'currency',
      detail: currency,
    },
  });

  return { currency };
});
