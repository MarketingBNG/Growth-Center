import { z } from 'zod';
import { body, route } from '@/lib/platform/api';
import { CURRENCIES, currencySettings, refreshRatesIfStale, saveCurrencySettings } from '@/lib/platform/settings';
import { TAGS, invalidate } from '@/lib/platform/cache';
import { recordAudit } from '@/lib/platform/audit';

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
  //
  // TAGS.metrics too, and that is the half this was missing. Dropping settings only
  // re-reads the rates; it does nothing for the six metrics reads that have ALREADY
  // converted with the old ones and cached the result — the analytics and marketing
  // bands, the trend, the channel table, campaign performance and attribution coverage.
  // Switching the reporting currency left every one of those showing figures derived
  // from the previous base for the rest of the five-minute TTL, on the one screen where
  // the user has just declared the old numbers wrong.
  await invalidate(TAGS.settings, TAGS.metrics);

  await recordAudit({
    actorEmail: user.email,
    action: 'settings.currency',
    entityType: 'app_setting',
    entityId: 'currency',
    detail: currency,
  
  });

  return { currency };
});

/** The settings page's Refresh button. */
export const POST = route('settings:manage', async () => {
  const currency = await refreshRatesIfStale(true);
  // Same pair as the PUT above: a new rate changes every converted figure, not just the
  // rate the settings page prints.
  await invalidate(TAGS.settings, TAGS.metrics);
  return { currency };
});
