// A per-caller token bucket.
//
// In-process and therefore honest about its limits: it does not survive a restart and
// does not coordinate across instances. It is not a defence against a distributed
// attacker. What it does do is turn "unbounded" into "bounded" for the two endpoints
// where unbounded is expensive — /api/ai/ask spends Anthropic tokens per call, and
// /api/public/v1/leads writes rows for anyone holding a key.
//
// Pure and dependency-free so tools/rate-limit.test.ts can drive the clock directly.

export type Bucket = { tokens: number; updatedAt: number };

export type LimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export type Limit = {
  /** Sustained rate. */
  perMinute: number;
  /** Maximum burst; defaults to `perMinute`. */
  burst?: number;
};

/**
 * Refills continuously rather than in fixed windows: a fixed window lets a caller spend
 * its whole allowance at 11:59:59 and again at 12:00:00, which is twice the intended
 * rate at the boundary.
 */
export function consume(
  bucket: Bucket | undefined,
  limit: Limit,
  now: number,
): { bucket: Bucket; result: LimitResult } {
  const capacity = limit.burst ?? limit.perMinute;
  const ratePerMs = limit.perMinute / 60_000;

  const current = bucket ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - current.updatedAt);
  const tokens = Math.min(capacity, current.tokens + elapsed * ratePerMs);

  if (tokens < 1) {
    // Time until one whole token is available again.
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - tokens) / ratePerMs / 1000));
    return { bucket: { tokens, updatedAt: now }, result: { allowed: false, retryAfterSeconds } };
  }

  return {
    bucket: { tokens: tokens - 1, updatedAt: now },
    result: { allowed: true, remaining: Math.floor(tokens - 1) },
  };
}

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound in a long-lived process. */
const MAX_KEYS = 10_000;

/**
 * Takes one token for `key`. `key` should identify the caller — a user email for a
 * signed-in route, an API key id for the public one. Never the IP alone, which is shared
 * behind NAT.
 */
export function rateLimit(key: string, limit: Limit, now = Date.now()): LimitResult {
  if (buckets.size > MAX_KEYS) {
    // Oldest-first eviction. Anything evicted simply starts full again, which is the
    // safe direction to fail for a convenience limiter.
    const stale = [...buckets.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, Math.floor(MAX_KEYS / 2));
    for (const [k] of stale) buckets.delete(k);
  }

  const { bucket, result } = consume(buckets.get(key), limit, now);
  buckets.set(key, bucket);
  return result;
}

/** Test seam. */
export function resetRateLimits() {
  buckets.clear();
}
