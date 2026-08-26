import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consume, rateLimit, resetRateLimits, type Bucket } from '../lib/rate-limit.ts';

// The clock is an argument, so these are deterministic — no sleeping.

test('a fresh caller gets the full burst then is refused', () => {
  let bucket: Bucket | undefined;
  const limit = { perMinute: 6, burst: 3 };
  const now = 1_000_000;

  for (let i = 0; i < 3; i++) {
    const r = consume(bucket, limit, now);
    bucket = r.bucket;
    assert.equal(r.result.allowed, true, `call ${i + 1} should pass`);
  }

  const denied = consume(bucket, limit, now);
  assert.equal(denied.result.allowed, false);
});

test('a refusal reports a usable retry delay, never zero', () => {
  const spent: Bucket = { tokens: 0, updatedAt: 1_000_000 };
  const r = consume(spent, { perMinute: 6 }, 1_000_000);
  assert.equal(r.result.allowed, false);
  if (!r.result.allowed) {
    assert.ok(r.result.retryAfterSeconds >= 1, 'retry must be at least a second');
    assert.ok(r.result.retryAfterSeconds <= 60);
  }
});

test('tokens refill continuously, so the allowance returns over time', () => {
  const spent: Bucket = { tokens: 0, updatedAt: 0 };
  // 6/minute is one every 10s.
  assert.equal(consume(spent, { perMinute: 6 }, 5_000).result.allowed, false);
  assert.equal(consume(spent, { perMinute: 6 }, 10_000).result.allowed, true);
});

test('refill is capped at the burst, so idling does not bank unlimited calls', () => {
  const idle: Bucket = { tokens: 0, updatedAt: 0 };
  // A full day later, the bucket holds burst — not a day's worth.
  const r = consume(idle, { perMinute: 6, burst: 3 }, 86_400_000);
  assert.equal(r.result.allowed, true);
  if (r.result.allowed) assert.equal(r.result.remaining, 2);
});

test('a clock that goes backwards does not grant free tokens', () => {
  const b: Bucket = { tokens: 1, updatedAt: 1_000_000 };
  const r = consume(b, { perMinute: 6, burst: 5 }, 500_000);
  assert.equal(r.result.allowed, true);
  // Elapsed is floored at 0, so it spends its one token rather than refilling.
  if (r.result.allowed) assert.equal(r.result.remaining, 0);
});

test('callers are limited independently', () => {
  resetRateLimits();
  const limit = { perMinute: 60, burst: 1 };
  assert.equal(rateLimit('user:a', limit, 0).allowed, true);
  assert.equal(rateLimit('user:a', limit, 0).allowed, false);
  // b is untouched by a's spending.
  assert.equal(rateLimit('user:b', limit, 0).allowed, true);
});
