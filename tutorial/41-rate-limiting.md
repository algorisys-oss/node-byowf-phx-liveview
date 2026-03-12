[← Step 40: SSL/TLS Support](40-ssl-tls-support.md) | [Step 42: Cluster Mode →](42-cluster-mode.md)

# Step 41 — Rate Limiting

## What We're Building

A token bucket rate limiter middleware that throttles requests per IP. Returns `429 Too Many Requests` when the limit is exceeded, with standard `x-ratelimit-*` headers on every response.

## Concepts You'll Learn

- **Token bucket algorithm** — rate limiting with gradual token refill
- **x-ratelimit-* headers** — standard rate limit communication
- **Sliding window** — tokens refill proportionally over time
- **Memory cleanup** — periodic eviction of expired buckets

## How It Works

### Token Bucket

Each IP address gets a bucket with `max` tokens (default: 100). Each request consumes one token. Tokens refill gradually over the window period:

```
Time 0:00 — Bucket: 100 tokens
  Request → 99 tokens remaining
  Request → 98 tokens remaining
  ...
Time 0:30 — 50 tokens refilled (half of window elapsed)
  Bucket: 48 + 50 = 98 tokens
Time 1:00 — Full refill
```

### Response Headers

Every response includes rate limit information:

```
x-ratelimit-limit: 100        ← max requests per window
x-ratelimit-remaining: 97     ← tokens left
x-ratelimit-reset: 45         ← seconds until refill
```

When rate limited:
```
HTTP/1.1 429 Too Many Requests
retry-after: 45
x-ratelimit-limit: 100
x-ratelimit-remaining: 0
x-ratelimit-reset: 45

429 Too Many Requests
```

### Cleanup

Buckets for IPs that have not made requests recently are periodically purged to prevent memory leaks. The cleanup interval runs every `windowMs` milliseconds and removes buckets whose `lastRefill` is older than `windowMs * 2`. The interval is `unref()`ed so it does not keep the process alive.

## The Code

### `src/blaze/rate_limit.ts` (new)

```typescript
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
```

Key details:

- **`ensureCleanup()`** starts a single `setInterval` that sweeps expired buckets every `windowMs`. The `.unref()` call ensures this timer does not prevent the process from exiting gracefully.
- **`defaultKey()`** extracts the client IP from the `x-forwarded-for` header (first entry), falling back to `"unknown"`. This works behind reverse proxies like nginx.
- **`resetBuckets()`** clears all state, useful in test suites.
- **Token refill** is proportional: if half the window has elapsed, half the tokens are restored. The `Math.floor` prevents fractional token grants.
- **When halted**, the middleware sets `retry-after` in addition to the `x-ratelimit-*` headers, and calls `ctx.halt()` to stop the middleware pipeline.

### Integration in `src/app.ts`

Add the rate limiter as the first middleware, before everything else:

```typescript
import { rateLimit } from "./blaze/rate_limit.js";

// Rate limiting (100 requests per minute per IP)
router.use(rateLimit({ max: 100, windowMs: 60_000 }));
```

## Try It Out

```bash
npm run dev
```

1. Check rate limit headers:
   ```bash
   curl -sD - -o /dev/null http://localhost:4001/hello | grep x-ratelimit
   # x-ratelimit-limit: 100
   # x-ratelimit-remaining: 99
   # x-ratelimit-reset: 60
   ```

2. Exhaust the bucket (rapid-fire requests):
   ```bash
   for i in $(seq 1 105); do
     status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4001/hello)
     echo "Request $i: $status"
   done
   # Requests 1-100: 200
   # Requests 101-105: 429
   ```

3. Wait 60 seconds, try again — tokens refill

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/rate_limit.ts` | **New** | Token bucket rate limiter with headers |
| `src/app.ts` | Modified | Added rate limit middleware |

## What's Next

**Step 42 — Cluster Mode:** `node:cluster` for multi-core scaling with IPC for cross-process PubSub.

[← Step 40: SSL/TLS Support](40-ssl-tls-support.md) | [Step 42: Cluster Mode →](42-cluster-mode.md)
