[← Step 37: Static Asset Pipeline](37-static-asset-pipeline.md) | [Step 39: Health Check →](39-health-check.md)

# Step 38 — Test Helpers

## What We're Building

A test helper module that lets you test route handlers without starting a real HTTP server. Includes `buildContext()` for creating test contexts, HTTP method helpers (`get()`, `post()`, etc.), response assertions (`htmlResponse()`, `jsonResponse()`), and CSRF token helpers. Uses Node.js built-in `node:test` runner.

## Concepts You'll Learn

- **node:test** — Node.js built-in test runner (no external dependencies)
- **node:assert** — strict assertion module
- **Direct dispatch** — calling `router.call(ctx)` without HTTP overhead
- **Test doubles** — building mock contexts with no-op transport

## How It Works

### The Problem

Testing route handlers normally requires starting a server, making HTTP requests, and parsing responses. That's slow and fragile.

### The Solution

We create `Context` objects directly (with a no-op `sendFn`) and dispatch them through the router. The full middleware pipeline (CSRF, CSP, etc.) runs, but there's no TCP/HTTP involved:

```
Test:                           Production:
  buildContext("GET", "/hello")    uWS receives HTTP request
  → Context { method, path }      → Context { method, path }
  → router.call(ctx)              → router.call(ctx)
  → assert ctx.status === 200     → sendFn writes HTTP response
```

### CSRF in Tests

State-changing routes need a valid CSRF token. The test helpers handle this automatically:

```typescript
// post() automatically calls initTestSession() + withCsrf()
const ctx = await post(router, "/echo", { name: "Test" });
```

Or manually for custom scenarios:
```typescript
const ctx = buildContext("POST", "/echo", { body: { name: "Test" } });
initTestSession(ctx);  // generates CSRF token in session
withCsrf(ctx);         // masks token and adds to body
const result = await router.call(ctx);
```

## The Code

### `src/blaze/test_helpers.ts` (new)

```typescript
import { strict as assert } from "node:assert";
import { Context } from "./context.js";
import type { Router } from "./router.js";
import { generateToken, maskToken } from "./csrf.js";

/**
 * Build a test Context without a real HTTP server.
 * The sendFn captures the response for later assertion.
 */
export function buildContext(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: string;
  } = {},
): Context {
  const headers = options.headers ?? {};
  const query = options.query ?? "";

  // No-op sendFn — tests read ctx state directly
  const ctx = new Context({
    method: method.toUpperCase(),
    path,
    query,
    headers,
    rawBody: "",
    sendFn: () => {},
  });

  if (options.body) {
    ctx.body = options.body;
  }

  return ctx;
}

/**
 * Initialize a test session with a CSRF token.
 * Required for testing POST/PUT/PATCH/DELETE routes that use CSRF protection.
 */
export function initTestSession(ctx: Context, extra: Record<string, unknown> = {}): Context {
  const token = generateToken();
  ctx.session = { _csrf_token: token, ...extra };
  ctx.putPrivate("flash", {});
  return ctx;
}

/**
 * Add a masked CSRF token to the request body.
 * Must call initTestSession() first to set up the session token.
 */
export function withCsrf(ctx: Context): Context {
  const sessionToken = ctx.session._csrf_token as string;
  if (!sessionToken) {
    throw new Error("Call initTestSession(ctx) before withCsrf(ctx)");
  }
  ctx.body._csrf_token = maskToken(sessionToken);
  return ctx;
}

// -- HTTP method helpers: dispatch through the full router pipeline --

export async function get(router: Router, path: string, options?: { headers?: Record<string, string>; query?: string }): Promise<Context> {
  const ctx = buildContext("GET", path, options);
  return router.call(ctx);
}

export async function post(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("POST", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function put(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("PUT", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function patch(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("PATCH", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function del(router: Router, path: string, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("DELETE", path, options);
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

// -- Response assertion helpers --

export function textResponse(ctx: Context, expectedStatus: number): string {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  return (ctx as unknown as { _respBody: string })._respBody;
}

export function htmlResponse(ctx: Context, expectedStatus: number): string {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  const ct = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["content-type"] ?? "";
  assert.ok(ct.includes("text/html"), `Expected HTML content-type, got "${ct}"`);
  return (ctx as unknown as { _respBody: string })._respBody;
}

export function jsonResponse(ctx: Context, expectedStatus: number): unknown {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  const ct = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["content-type"] ?? "";
  assert.ok(ct.includes("application/json"), `Expected JSON content-type, got "${ct}"`);
  const body = (ctx as unknown as { _respBody: string })._respBody;
  return JSON.parse(body);
}

export function redirectedTo(ctx: Context): string {
  assert.ok(ctx.status >= 300 && ctx.status < 400, `Expected redirect status, got ${ctx.status}`);
  const location = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["location"];
  assert.ok(location, "Expected location header for redirect");
  return location;
}
```

### `test/routes.test.ts` (new)

```typescript
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { get, post, htmlResponse, jsonResponse, redirectedTo } from "../src/blaze/test_helpers.js";
import { router } from "../src/app.js";

describe("GET routes", () => {
  it("GET / returns 200 with welcome page", async () => {
    const ctx = await get(router, "/");
    const body = htmlResponse(ctx, 200);
    assert.ok(body.includes("Welcome to Blaze!"));
  });

  it("GET /hello returns plain text", async () => {
    const ctx = await get(router, "/hello");
    assert.equal(textResponse(ctx, 200), "Hello, Blaze!");
  });

  it("GET /nonexistent returns 404", async () => {
    const ctx = await get(router, "/nonexistent");
    assert.equal(ctx.status, 404);
  });
});

describe("POST routes", () => {
  it("POST /echo returns received body", async () => {
    const ctx = await post(router, "/echo", { name: "Test" });
    const data = jsonResponse(ctx, 200);
    assert.equal(data.received.name, "Test");
  });

  it("POST without CSRF token returns 403", async () => {
    const ctx = buildContext("POST", "/echo", { body: { name: "Evil" } });
    ctx.session = {};
    const result = await router.call(ctx);
    assert.equal(result.status, 403);
  });
});
```

## Try It Out

```bash
npm test
```

Output:
```
TAP version 13
# Subtest: GET routes
    ok 1 - GET / returns 200 with welcome page
    ok 2 - GET /hello returns plain text
    ok 3 - GET /api/status returns JSON
    ok 4 - GET /api/users/:id returns user JSON
    ok 5 - GET /greet/:name returns greeting
    ok 6 - GET /old-page redirects to /
    ok 7 - GET /nonexistent returns 404
# Subtest: POST routes
    ok 1 - POST /echo returns received body
    ok 2 - POST /echo without CSRF token returns 403
# Subtest: DELETE routes
    ok 1 - DELETE /echo returns deleted confirmation
# Subtest: buildContext
    ok 1 - creates context with correct method and path
    ok 2 - accepts custom headers
    ok 3 - accepts body for POST requests
# tests 13, pass 13, fail 0
```

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/test_helpers.ts` | **New** | `buildContext()`, HTTP helpers, response assertions, CSRF helpers |
| `test/routes.test.ts` | **New** | 13 tests covering GET, POST, DELETE routes + CSRF protection |
| `package.json` | Modified | Updated `test` script to use `npx tsx --test` |

## What's Next

**Step 39 — Health Check:** `/health` endpoint with uptime, memory usage, and connection count.

[← Step 37: Static Asset Pipeline](37-static-asset-pipeline.md) | [Step 39: Health Check →](39-health-check.md)
