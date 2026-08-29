import { db, hasDb } from './prisma.ts';
import { CURRENCIES, defaultCurrencySettings, parseCurrencySettings, type CurrencySettings } from './currency.ts';

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
