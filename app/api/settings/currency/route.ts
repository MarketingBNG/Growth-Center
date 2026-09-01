import { z } from 'zod';
import { body, route } from '@/lib/api';
import { db } from '@/lib/prisma';
import { CURRENCIES, currencySettings, refreshRatesIfStale, saveCurrencySettings } from '@/lib/settings';
import { TAGS, invalidate } from '@/lib/cache';

const codes = CURRENCIES.map((c) => c.code) as [string, ...string[]];

export const GET = route('settings:manage', async () => {
  return { currency: await currencySettings() };
});

export const PUT = route('settings:manage', async (user, req) => {
  const input = await body(
    req,
    z.object({
      reporting: z.enum(codes),
      mode: z.enum(['live', 'manual']),
      // Units of the currency per one unit of the reporting currency. Positive and finite
      // — a zero rate divides every converted figure into infinity.
      rates: z.record(z.enum(codes), z.number().positive().finite()),
    }),
  );

  const existing = await currencySettings();
  let currency = await saveCurrencySettings({
    ...input,
    // Manual rates are the user's own figures, so they are no longer dated or attributed
    // to a source that did not supply them.
    fetchedAt: input.mode === 'live' ? existing.fetchedAt : null,
    source: input.mode === 'live' ? existing.source : null,
  });

  // Switching to live, or changing which currency is reported in, makes the stored rates
  // the wrong ones — they are quoted against the previous base.
  if (currency.mode === 'live' && (existing.mode !== 'live' || existing.reporting !== currency.reporting)) {
    currency = await refreshRatesIfStale(true);
  }

  // The reporting currency sits behind every money figure in the app, so the cached read
  // has to go the moment it changes rather than at the end of its TTL.
  await invalidate(TAGS.settings);

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

/** The settings page's Refresh button. */
export const POST = route('settings:manage', async () => {
  const currency = await refreshRatesIfStale(true);
  await invalidate(TAGS.settings);
  return { currency };
});
