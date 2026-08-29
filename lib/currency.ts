// Currency, and the arithmetic of reporting in one of them.
//
// Imports nothing, so a client component can format money and tools/*.test.ts can
// exercise the conversion without a database.
//
// The problem this exists for: the Meta ad account bills in INR and most deals are
// written in USD, and every figure in the app was rendered with a dollar sign and summed
// as though currency did not exist. A ₹292 cost per lead read as $292, and ROAS divided
// dollars of revenue by rupees of spend — a number that was wrong by roughly ninety times
// and looked entirely plausible.

export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export type CurrencySettings = {
  /** The currency every figure is expressed in. */
  reporting: CurrencyCode;
  /**
   * Units of each currency per one unit of `reporting`. The reporting currency itself is
   * always 1, whatever is stored, so a rate can never contradict the currency it is
   * quoted against.
   */
  rates: Record<string, number>;
};

export const defaultCurrencySettings = (): CurrencySettings => ({
  reporting: 'USD',
  // A starting point, not a live rate. Shown in the settings form so it is edited
  // knowingly rather than trusted silently.
  rates: { USD: 1, INR: 87 },
});

const isCode = (v: unknown): v is CurrencyCode =>
  typeof v === 'string' && CURRENCIES.some((c) => c.code === v);

/**
 * Reads a stored settings value back into a usable shape.
 *
 * Anything unrecognised degrades to the defaults rather than throwing. These settings are
 * read on every page that shows money; a malformed row must not be able to take the
 * dashboard down, and a NaN rate would silently blank every figure instead.
 */
export function parseCurrencySettings(raw: unknown): CurrencySettings {
  const base = defaultCurrencySettings();
  if (!raw || typeof raw !== 'object') return base;

  const v = raw as Record<string, unknown>;
  const reporting = isCode(v.reporting) ? v.reporting : base.reporting;

  const rates: Record<string, number> = { ...base.rates };
  if (v.rates && typeof v.rates === 'object') {
    for (const [code, value] of Object.entries(v.rates as Record<string, unknown>)) {
      const n = Number(value);
      // A zero or negative rate is not a rate; it would divide the figure into infinity.
      if (isCode(code) && Number.isFinite(n) && n > 0) rates[code] = n;
    }
  }

  // The reporting currency is its own unit by definition.
  rates[reporting] = 1;
  return { reporting, rates };
}

export const symbolOf = (code: string): string =>
  CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;

/**
 * An amount in `from`, expressed in the reporting currency.
 *
 * Returns null rather than a guess when the currency has no rate: a figure the workspace
 * has not been told how to convert must be visibly absent, not quietly counted as though
 * it were already in the reporting currency — which is the bug this whole file exists to
 * fix.
 */
export function convert(
  amount: number,
  from: string | null | undefined,
  settings: CurrencySettings,
): number | null {
  const code = (from ?? settings.reporting).toUpperCase();
  if (code === settings.reporting) return amount;

  const rate = settings.rates[code];
  if (!rate || !Number.isFinite(rate)) return null;

  // `rates` is quoted as units-per-reporting-unit, so converting into the reporting
  // currency divides.
  return amount / rate;
}

/** Sums amounts that carry their own currency, converting each. Anything with no rate is
 *  counted separately so the caller can say how much it could not include, rather than
 *  presenting a total that quietly omits it. */
export function sumInReporting(
  rows: { amount: number; currency: string | null }[],
  settings: CurrencySettings,
): { total: number; unconverted: { currency: string; amount: number }[] } {
  let total = 0;
  const missed = new Map<string, number>();

  for (const row of rows) {
    const converted = convert(row.amount, row.currency, settings);
    if (converted === null) {
      const code = (row.currency ?? '').toUpperCase() || 'unknown';
      missed.set(code, (missed.get(code) ?? 0) + row.amount);
    } else {
      total += converted;
    }
  }

  return {
    total,
    unconverted: [...missed].map(([currency, amount]) => ({ currency, amount })),
  };
}
