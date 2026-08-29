import { CURRENCIES, type CurrencyCode } from './currency.ts';

// Live reference rates. Server-only: it makes network calls.
//
// Two sources, tried in order, because a rate that silently stops refreshing is a wrong
// number that looks exactly like a right one. Neither needs an API key, so there is no
// credential to expire and no per-workspace setup.
//
// Frankfurter publishes the European Central Bank's daily reference rates — a published,
// citable figure rather than a broker's quote, which is what a finance team wants behind a
// converted total. exchangerate-api is the fallback and updates more often.

export type FetchedRates = {
  /** Units of each currency per one unit of `base`. */
  rates: Record<string, number>;
  source: string;
  fetchedAt: string;
};

const TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** The currencies this app reports in, minus the base — the only ones worth asking for. */
const others = (base: CurrencyCode) => CURRENCIES.map((c) => c.code).filter((c) => c !== base);

function usable(raw: unknown, wanted: string[]): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const table = (raw as { rates?: unknown }).rates;
  if (!table || typeof table !== 'object') return null;

  const out: Record<string, number> = {};
  for (const code of wanted) {
    const n = Number((table as Record<string, unknown>)[code]);
    // A rate of zero or worse is not a rate. One missing currency invalidates the whole
    // response rather than half-updating the table, which would leave the others stale
    // without saying so.
    if (!Number.isFinite(n) || n <= 0) return null;
    out[code] = n;
  }
  return out;
}

/**
 * Today's rates against `base`, or null if no source answered.
 *
 * Null rather than a fallback constant: the caller keeps whatever rates it already had,
 * which are at worst yesterday's. Substituting a hard-coded number here would put a
 * figure nobody chose behind every total on the dashboard.
 */
export async function fetchRates(base: CurrencyCode): Promise<FetchedRates | null> {
  const wanted = others(base);
  if (!wanted.length) {
    return { rates: {}, source: 'none needed', fetchedAt: new Date().toISOString() };
  }

  const sources: { url: string; name: string }[] = [
    {
      url: `https://api.frankfurter.app/latest?from=${base}&to=${wanted.join(',')}`,
      name: 'European Central Bank (frankfurter.app)',
    },
    {
      url: `https://open.er-api.com/v6/latest/${base}`,
      name: 'exchangerate-api.com',
    },
  ];

  for (const source of sources) {
    const rates = usable(await getJson(source.url), wanted);
    if (rates) {
      return { rates: { ...rates, [base]: 1 }, source: source.name, fetchedAt: new Date().toISOString() };
    }
  }

  return null;
}
