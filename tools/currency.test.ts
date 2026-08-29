import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RATE_STALE_HOURS,
  convert,
  defaultCurrencySettings,
  parseCurrencySettings,
  rateAgeHours,
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
  // Compared against the default rather than a literal: the fallback is a starting point
  // that live mode overwrites, and a test that pins its value would fail on every update.
  const fallback = defaultCurrencySettings().rates.INR;

  const zero = parseCurrencySettings({ reporting: 'USD', rates: { INR: 0 } });
  assert.equal(zero.rates.INR, fallback, 'zero would divide the figure into infinity');

  const negative = parseCurrencySettings({ reporting: 'USD', rates: { INR: -3 } });
  assert.equal(negative.rates.INR, fallback);

  const text = parseCurrencySettings({ reporting: 'USD', rates: { INR: 'ninety-five' } });
  assert.equal(text.rates.INR, fallback);
});

test('rate age is reported so a feed that stopped is visible', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  // Never fetched is not "fresh"; it is unknown, and the caller must be able to tell.
  assert.equal(rateAgeHours(parseCurrencySettings({}), now), null);
  assert.equal(rateAgeHours(parseCurrencySettings({ fetchedAt: 'not a date' }), now), null);

  const six = parseCurrencySettings({ fetchedAt: '2026-08-29T06:00:00Z' });
  assert.equal(rateAgeHours(six, now), 6);

  const old = parseCurrencySettings({ fetchedAt: '2026-08-25T12:00:00Z' });
  assert.ok((rateAgeHours(old, now) ?? 0) > RATE_STALE_HOURS);
});

test('mode defaults to live, and only the exact word turns it off', () => {
  assert.equal(parseCurrencySettings({}).mode, 'live');
  assert.equal(parseCurrencySettings({ mode: 'manual' }).mode, 'manual');
  assert.equal(parseCurrencySettings({ mode: 'whatever' }).mode, 'live');
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
