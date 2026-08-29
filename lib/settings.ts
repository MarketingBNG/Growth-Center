import { db, hasDb } from './prisma.ts';
import {
  CURRENCIES,
  RATE_STALE_HOURS,
  defaultCurrencySettings,
  parseCurrencySettings,
  rateAgeHours,
  type CurrencySettings,
} from './currency.ts';
import { fetchRates } from './fx.ts';

// Workspace preferences. One row per key in app_setting, read as a block.
//
// Kept apart from lib/currency.ts on purpose: that file is pure and importable from a
// client component, this one touches the database.

const CURRENCY_KEY = 'currency';

/**
 * The workspace's currency settings, or the defaults.
 *
 * Never throws and never returns a half-valid shape: a settings row written by an older
 * version, or by hand, falls back to the defaults rather than putting NaN through every
 * money figure on the dashboard.
 */
export async function currencySettings(): Promise<CurrencySettings> {
  if (!hasDb()) return defaultCurrencySettings();
  const row = await db().appSetting.findUnique({ where: { key: CURRENCY_KEY } });
  return parseCurrencySettings(row?.value);
}

export async function saveCurrencySettings(input: unknown): Promise<CurrencySettings> {
  const settings = parseCurrencySettings(input);
  await db().appSetting.upsert({
    where: { key: CURRENCY_KEY },
    create: { key: CURRENCY_KEY, value: settings },
    update: { value: settings },
  });
  return settings;
}

export { CURRENCIES };
export type { CurrencySettings };

/**
 * Refreshes the live rates if they are stale, and returns the settings either way.
 *
 * Called from the page that reads them rather than only from the cron, so a workspace
 * that has not synced today still converts at today's rate. `force` is the settings
 * page's Refresh button.
 *
 * A failed fetch keeps the rates already stored — at worst yesterday's — and leaves
 * `fetchedAt` alone so the settings page can say how old they are. Falling back to a
 * constant would put a figure nobody chose behind every total.
 */
export async function refreshRatesIfStale(force = false): Promise<CurrencySettings> {
  const settings = await currencySettings();
  if (settings.mode !== 'live') return settings;

  const age = rateAgeHours(settings);
  if (!force && age !== null && age < RATE_STALE_HOURS) return settings;

  const fresh = await fetchRates(settings.reporting);
  if (!fresh) return settings;

  return saveCurrencySettings({
    ...settings,
    rates: { ...settings.rates, ...fresh.rates },
    fetchedAt: fresh.fetchedAt,
    source: fresh.source,
  });
}

export { rateAgeHours, RATE_STALE_HOURS };
