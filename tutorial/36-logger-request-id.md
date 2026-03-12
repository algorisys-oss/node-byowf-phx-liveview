[← Step 35: Debug Error Page](35-debug-error-page.md) | [Step 37: Static Asset Pipeline →](37-static-asset-pipeline.md)

# Step 36 — Logger & Request ID

## What We're Building

Structured request logging with per-request IDs using `AsyncLocalStorage`. Every HTTP request gets a unique ID (set as the `x-request-id` response header), and the log output is color-coded by method and status with response timing.

## Concepts You'll Learn

- **AsyncLocalStorage** — `node:async_hooks` API for per-request context without passing state through every function
- **Request ID** — unique identifier for tracing a request through logs
- **Structured logging** — consistent format with method, path, status, duration
- **ANSI colors** — terminal escape codes for color-coded output

## How It Works

### AsyncLocalStorage

Node.js is single-threaded but handles many concurrent requests via async I/O. `AsyncLocalStorage` provides a way to store per-request data that "flows" through async callbacks without explicitly threading it through function arguments:

```
Request A arrives → requestStorage.run({ requestId: "a1b2c3d4" }, async () => {
  await router.call(ctx);        // ← getRequestId() returns "a1b2c3d4"
  await someDbQuery();            // ← getRequestId() still returns "a1b2c3d4"
});

Request B arrives → requestStorage.run({ requestId: "e5f6g7h8" }, async () => {
  await router.call(ctx);        // ← getRequestId() returns "e5f6g7h8"
});
```

Each request's async context is isolated — no global state, no race conditions.

### Log Output

```
[798af687] GET     /hello 200 4.9ms
[017b098f] GET     /api/status 200 0.3ms
[ed39d87d] POST    /echo 403 0.2ms
```

- **Request ID** in dim brackets — first 8 chars of a UUID
- **Method** — color-coded (GET=cyan, POST=yellow, PUT=blue, PATCH=magenta, DELETE=red)
- **Path** — the requested URL
- **Status** — color-coded (2xx=green, 3xx=cyan, 4xx=yellow, 5xx=red)
- **Duration** — time from request start to response

### Integration Point

The logger runs at the **server level** (in `server.ts`), not as router middleware. This means:
1. It captures ALL requests, including static files and LiveView pages
2. Request ID and timing are set before any router middleware runs
3. The entire request handler runs inside `requestStorage.run()`, so any code can call `getRequestId()` to get the current request's ID

## The Code

### `src/blaze/logger.ts` (new)

```typescript
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "./context.js";

/** AsyncLocalStorage for per-request context (request ID, etc.) */
export const requestStorage = new AsyncLocalStorage<{ requestId: string }>();

/** Generate a short unique request ID. */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Get the current request ID from AsyncLocalStorage (if available). */
export function getRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

/** Color code for HTTP status. */
function statusColor(status: number): string {
  if (status >= 500) return "\x1b[31m"; // red
  if (status >= 400) return "\x1b[33m"; // yellow
  if (status >= 300) return "\x1b[36m"; // cyan
  if (status >= 200) return "\x1b[32m"; // green
  return "\x1b[0m";
}

/** Color code for HTTP method. */
function methodColor(method: string): string {
  switch (method) {
    case "GET": return "\x1b[36m";    // cyan
    case "POST": return "\x1b[33m";   // yellow
    case "PUT": return "\x1b[34m";    // blue
    case "PATCH": return "\x1b[35m";  // magenta
    case "DELETE": return "\x1b[31m"; // red
    default: return "\x1b[0m";
  }
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

/**
 * Logger middleware: assigns request ID and start time.
 * Called at the server level before router middleware.
 */
export function loggerMiddleware(ctx: Context): Context {
  const requestId = generateRequestId();
  ctx.putPrivate("requestId", requestId);
  ctx.putPrivate("startTime", performance.now());
  ctx.setHeader("x-request-id", requestId);
  return ctx;
}

/**
 * Log a completed request. Call after the response is ready.
 */
export function logRequest(ctx: Context): void {
  const requestId = (ctx.getPrivate("requestId") as string) ?? "--------";
  const startTime = ctx.getPrivate("startTime") as number | undefined;
  const duration = startTime ? (performance.now() - startTime).toFixed(1) : "?";
  const method = ctx.method;
  const path = ctx.path;
  const status = ctx.status;

  console.log(
    `${DIM}[${requestId}]${RESET} ` +
    `${methodColor(method)}${method.padEnd(7)}${RESET} ` +
    `${path} ` +
    `${statusColor(status)}${status}${RESET} ` +
    `${DIM}${duration}ms${RESET}`,
  );
}
```

### Changes to `src/blaze/server.ts`

The server's HTTP handler now wraps each request in `requestStorage.run()`:

```typescript
import { loggerMiddleware, logRequest, requestStorage } from "./logger.js";

// Inside handleRequest:
loggerMiddleware(ctx);

const requestId = ctx.getPrivate("requestId") as string;
await requestStorage.run({ requestId }, async () => {
  try {
    if (router) {
      await router.call(ctx);
      // ... encode session, set cookie ...
      logRequest(ctx);
      ctx.send();
      return;
    }
    // default response...
    logRequest(ctx);
    ctx.send();
  } catch (error) {
    ctx.setStatus(500);
    logRequest(ctx);
    // ... send error page ...
  }
});
```

### Changes to `src/app.ts`

The old manual logging middleware is removed — the server-level logger handles it:

```diff
-// Log every request
-router.use((ctx) => {
-  console.log(`${ctx.method} ${ctx.path}`);
-  return ctx;
-});
-
-// Request timing (store start time in private state)
-router.use((ctx) => {
-  ctx.putPrivate("startTime", performance.now());
-  return ctx;
-});
```

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/hello` — check the terminal for colored log output:
   ```
   [a1b2c3d4] GET     /hello 200 3.2ms
   ```
2. Check the response header:
   ```bash
   curl -sD - -o /dev/null http://localhost:4001/hello | grep x-request-id
   # x-request-id: a1b2c3d4
   ```
3. Visit `/crash` — the 500 error is logged in red:
   ```
   [e5f6g7h8] GET     /crash 500 1.1ms
   ```
4. POST without CSRF token — 403 logged in yellow:
   ```bash
   curl -sX POST http://localhost:4001/echo
   # Terminal: [deadbeef] POST    /echo 403 0.2ms
   ```
5. Use `getRequestId()` from anywhere in your async handler — it returns the current request's ID without passing it as a parameter.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/logger.ts` | **New** | Structured logging with AsyncLocalStorage, request ID, color-coded output |
| `src/blaze/server.ts` | Modified | Integrated logger middleware, wrapped handler in `requestStorage.run()` |
| `src/app.ts` | Modified | Removed old `console.log` and `startTime` middleware (logger handles both) |

## What's Next

**Step 37 — Rate Limiter:** Token-bucket rate limiting middleware to throttle abusive clients.

[← Step 35: Debug Error Page](35-debug-error-page.md) | [Step 37: Static Asset Pipeline →](37-static-asset-pipeline.md)
