import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  convert,
  defaultCurrencySettings,
  parseCurrencySettings,
  sumInReporting,
} from '../lib/currency.ts';

// The bug these guard against: the Meta account bills in INR, most deals are written in
// USD, and every figure was summed as though currency did not exist — a ₹292 cost per
// lead reading as $292, and ROAS off by roughly ninety times while looking plausible.

test('an amount already in the reporting currency is untouched', () => {
  const s = defaultCurrencySettings();
  assert.equal(convert(100, 'USD', s), 100);
  // A missing currency means the reporting one; nothing else can be assumed about it.
  assert.equal(convert(100, null, s), 100);
});

test('converting divides, because rates are quoted per reporting unit', () => {
  const s = parseCurrencySettings({ reporting: 'USD', rates: { INR: 87 } });
  assert.equal(convert(8700, 'INR', s), 100);
});

test('a currency with no rate converts to null, never to itself', () => {
  // Treating it as already-converted is exactly how rupees came to be counted as dollars.
  const s = parseCurrencySettings({ reporting: 'USD', rates: { INR: 87 } });
  assert.equal(convert(100, 'EUR', s), null);
});

test('the reporting currency is always its own unit, whatever is stored', () => {
  const s = parseCurrencySettings({ reporting: 'INR', rates: { INR: 87, USD: 1 } });
  assert.equal(s.rates.INR, 1);
  assert.equal(convert(500, 'INR', s), 500);
});

test('a nonsense rate falls back rather than blanking every figure', () => {
  const zero = parseCurrencySettings({ reporting: 'USD', rates: { INR: 0 } });
  assert.equal(zero.rates.INR, 87, 'zero would divide the figure into infinity');

  const negative = parseCurrencySettings({ reporting: 'USD', rates: { INR: -3 } });
  assert.equal(negative.rates.INR, 87);

  const text = parseCurrencySettings({ reporting: 'USD', rates: { INR: 'eighty-seven' } });
  assert.equal(text.rates.INR, 87);
});

test('a malformed settings row degrades to the defaults', () => {
  assert.deepEqual(parseCurrencySettings(null), defaultCurrencySettings());
  assert.deepEqual(parseCurrencySettings('nonsense'), defaultCurrencySettings());
  assert.equal(parseCurrencySettings({ reporting: 'GBP' }).reporting, 'USD');
});

test('a sum reports what it could not convert instead of hiding it', () => {
  const s = parseCurrencySettings({ reporting: 'USD', rates: { INR: 87 } });
  const out = sumInReporting(
    [
      { amount: 100, currency: 'USD' },
      { amount: 8700, currency: 'INR' },
      { amount: 50, currency: 'EUR' },
    ],
    s,
  );
  assert.equal(out.total, 200);
  assert.deepEqual(out.unconverted, [{ currency: 'EUR', amount: 50 }]);
});
