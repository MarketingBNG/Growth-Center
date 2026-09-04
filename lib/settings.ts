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
import { TAGS, cached } from './cache.ts';
import {
  THRESHOLDS,
  THRESHOLD_KEYS,
  isThresholdKey,
  parseThresholdValue,
  type ThresholdKey,
  type Thresholds,
} from './thresholds.ts';

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
async function readCurrencySettings(): Promise<CurrencySettings> {
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
  // Deliberately the uncached read: this function writes what it reads back, and a
  // cached value from before a currency change would save the previous reporting
  // currency over the new one. Correctness beats the round trip here, and the settings
  // page is the only screen that calls it on render.
  const settings = await readCurrencySettings();
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

/**
 * Called upwards of a dozen times in a single page render — every money figure needs the
 * reporting currency and its rates — and each call was its own query. One cached read
 * now serves all of them, and `saveCurrencySettings` drops it on write so a changed
 * currency shows up on the next screen rather than five minutes later.
 */
export const currencySettings = cached('settings:currency', [TAGS.settings], readCurrencySettings);

// ── Rule thresholds ───────────────────────────────────────────────────────────────────
//
// §20.5: "Thresholds live in a config table, editable by Shweta with the change
// recorded. They are never hard-coded and never decided by the model." What each one
// means and what it defaults to is in lib/thresholds.ts, which is pure so the settings
// card can render it; the reading and writing are here, with the rest of app_setting.

/**
 * Read straight through, not cached.
 *
 * It was cached on the settings tag at first, and a saved threshold did not reach the
 * rules: the floor was set to 99,999 and the run still raised all fifteen task-debt
 * findings from the old value of 25. `revalidateTag` did not drop the `unstable_cache`
 * entry, and a threshold nobody can see move is worse than useless — it makes the setting
 * look broken while the rules quietly use the old number.
 *
 * Not worth caching anyway: ten rows fetched by primary key, read once per rule run and
 * once per settings render. This file's own rule covers it — anything a user edits and
 * expects to see change stays uncached and pays the round trip.
 */
export async function thresholds(): Promise<Thresholds> {
  const out = Object.fromEntries(
    THRESHOLD_KEYS.map((k) => [k, THRESHOLDS[k].default]),
  ) as Thresholds;
  if (!hasDb()) return out;

  const rows = await db().appSetting.findMany({ where: { key: { in: THRESHOLD_KEYS } } });
  for (const row of rows) {
    if (isThresholdKey(row.key)) out[row.key] = parseThresholdValue(row.key, row.value);
  }
  return out;
}

export async function saveThreshold(key: ThresholdKey, value: unknown): Promise<number> {
  const parsed = parseThresholdValue(key, value);
  await db().appSetting.upsert({
    where: { key },
    // Stored as { value }: AppSetting.value is Json and every other key here holds an
    // object. parseThresholdValue also reads `percent`, which is the shape the attribution
    // threshold was written in before this existed.
    create: { key, value: { value: parsed } },
    update: { value: { value: parsed } },
  });
  return parsed;
}
