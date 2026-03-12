/**
 * Blaze Rate Limiter -- Sliding window rate limiting per IP.
 *
 * Uses a token bucket algorithm: each IP gets a bucket with max tokens.
 * Tokens refill over time. Each request consumes one token.
 * When tokens run out, respond with 429 Too Many Requests.
 *
 * Sets standard rate limit headers:
 *   x-ratelimit-limit: max requests per window
 *   x-ratelimit-remaining: tokens left
 *   x-ratelimit-reset: seconds until bucket refills
 */

import type { Context } from "./context.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitOptions {
  /** Maximum requests per window (default: 100) */
  max?: number;
  /** Window size in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Custom key extractor (default: uses x-forwarded-for or "unknown") */
  keyFn?: (ctx: Context) => string;
}

const buckets = new Map<string, Bucket>();

/** Periodically clean up expired buckets to prevent memory leaks */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(windowMs: number): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, windowMs);
  // Don't keep the process alive just for cleanup
  if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Create a rate limiting middleware.
 *
 * Usage:
 *   router.use(rateLimit({ max: 100, windowMs: 60_000 }));
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const keyFn = options.keyFn ?? defaultKey;

  ensureCleanup(windowMs);

  return (ctx: Context): Context => {
    const key = keyFn(ctx);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: max, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor((elapsed / windowMs) * max);
    if (refill > 0) {
      bucket.tokens = Math.min(max, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    // Calculate reset time (seconds until next full refill)
    const resetSeconds = Math.ceil((windowMs - (now - bucket.lastRefill)) / 1000);

    // Set rate limit headers on every response
    ctx.setHeader("x-ratelimit-limit", String(max));
    ctx.setHeader("x-ratelimit-remaining", String(Math.max(0, bucket.tokens - 1)));
    ctx.setHeader("x-ratelimit-reset", String(resetSeconds));

    // Check if rate limited
    if (bucket.tokens <= 0) {
      ctx.setHeader("retry-after", String(resetSeconds));
      ctx
        .setStatus(429)
        .setHeader("content-type", "text/plain")
        .setBody("429 Too Many Requests")
        .halt();
      return ctx;
    }

    // Consume a token
    bucket.tokens--;
    return ctx;
  };
}

function defaultKey(ctx: Context): string {
  return ctx.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Reset all rate limit buckets (useful for testing).
 */
export function resetBuckets(): void {
  buckets.clear();
}
