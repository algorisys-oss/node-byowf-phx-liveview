# Step 4: Response Helpers

[← Previous: Step 3 - Router](03-router.md) | [Next: Step 5 - Dynamic Routes →](05-dynamic-routes.md)

---

## What We're Building

In Step 3, our route handlers set headers and body manually every time:

```typescript
router.get("/", (ctx) => {
  ctx.setHeader("content-type", "text/html").setBody("<h1>Welcome!</h1>");
  return ctx;
});
```

This is repetitive and error-prone. What if you forget the content-type?
What if you misspell `"text/plainn"`?

In this step, we create **response helper functions** -- `text()`, `html()`,
`json()`, and `redirect()` -- that set the correct status, content-type,
and body automatically. These are the equivalent of Phoenix's controller
helpers.

### How This Compares to Ignite (Elixir)

In Elixir, `Ignite.Controller` provides functions like `text(conn, body)`,
`html(conn, body)`, `json(conn, data)`, and `redirect(conn, to: path)`.
Each returns a new conn with the response fields set and `halted: true`.

In Blaze, our helpers are standalone functions (not methods on Context)
that take a context, set the response, and halt the pipeline. Same pattern,
same purpose. Identical API across the Bun and Node.js versions.

## Concepts You'll Learn

### Response Helpers as Pipeline Functions

Each helper follows the same pattern:

1. Set the HTTP status code
2. Set the appropriate `content-type` header
3. Set the response body
4. Halt the pipeline (so middleware doesn't overwrite the response)
5. Return the context

```typescript
function text(ctx, body, status = 200) {
  return ctx.setStatus(status).setHeader("content-type", "text/plain").setBody(body).halt();
}
```

### Why `halt()`?

When we add middleware (Step 7), the pipeline will look like:

```
Request → [logger] → [auth] → [router/handler] → [after-middleware?]
```

After a handler sends a response, we don't want later middleware to
overwrite it. Setting `halted = true` signals "this request has been
answered -- stop processing."

### Content-Type Matters

The `content-type` header tells the browser how to interpret the response:

| Helper | Content-Type | Browser Behavior |
|---|---|---|
| `text()` | `text/plain` | Displays raw text |
| `html()` | `text/html; charset=utf-8` | Renders HTML |
| `json()` | `application/json` | Parsed as JSON by `fetch()` |
| `redirect()` | (+ `location` header) | Browser navigates to new URL |

### JSON Serialization

The `json()` helper uses `JSON.stringify()` to convert any JavaScript
value to a JSON string. In Elixir, this uses `Jason.encode!/1`.

```typescript
json(ctx, { status: "ok", count: 42 })
// Body: '{"status":"ok","count":42}'
// Content-Type: application/json
```

### Redirect Status Codes

The `redirect()` helper defaults to `302 Found` (temporary redirect).
You can pass `301` for permanent redirects:

```typescript
redirect(ctx, "/new-url")       // 302 temporary
redirect(ctx, "/new-url", 301)  // 301 permanent
```

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Text response | `text(conn, "Hello")` | `text(ctx, "Hello")` | `text(ctx, "Hello")` |
| HTML response | `html(conn, "<h1>Hi</h1>")` | `html(ctx, "<h1>Hi</h1>")` | `html(ctx, "<h1>Hi</h1>")` |
| JSON response | `json(conn, %{ok: true})` | `json(ctx, { ok: true })` | `json(ctx, { ok: true })` |
| Redirect | `redirect(conn, to: "/")` | `redirect(ctx, "/")` | `redirect(ctx, "/")` |
| Custom status | `text(conn, "Nope", 403)` | `text(ctx, "Nope", 403)` | `text(ctx, "Nope", 403)` |
| Halts pipeline | Yes | Yes | Yes |
| JSON encoder | `Jason.encode!/1` | `JSON.stringify()` | `JSON.stringify()` |

The Bun and Node.js APIs are **identical**. The only difference is the
import path extension (`.ts` vs `.js`).

## The Code

### `src/blaze/controller.ts` -- Response Helpers

```typescript
/**
 * Blaze Controller -- Response helpers.
 *
 * Equivalent to Ignite.Controller in the Elixir version.
 * Functions that set the right status, content-type, and body
 * on a Context, then halt the pipeline.
 */

import type { Context } from "./context.js";

export function text(ctx: Context, body: string, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "text/plain")
    .setBody(body)
    .halt();
}

export function html(ctx: Context, body: string, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setBody(body)
    .halt();
}

export function json(ctx: Context, data: unknown, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "application/json")
    .setBody(JSON.stringify(data))
    .halt();
}

export function redirect(ctx: Context, to: string, status: number = 302): Context {
  return ctx
    .setStatus(status)
    .setHeader("location", to)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setBody("")
    .halt();
}
```

**Key decisions:**

- **Standalone functions, not methods:** These are imported and called as
  `text(ctx, ...)`, not `ctx.text(...)`. This keeps the Context class
  focused on data and lets helpers be tree-shaken if unused.
- **Each helper halts:** After sending a response, the pipeline stops.
  This prevents accidental double-responses.
- **`data: unknown` for json():** Accepts any serializable value -- objects,
  arrays, strings, numbers.
- **Default status codes:** 200 for content responses, 302 for redirects.
  Override with the third argument.

### `src/app.ts` -- Updated Application

```typescript
import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";
import { text, html, json, redirect } from "./blaze/controller.js";

const router = new Router();

router.get("/", (ctx) => html(ctx, "<h1>Welcome to Blaze!</h1>"));

router.get("/hello", (ctx) => text(ctx, "Hello, Blaze!"));

router.get("/api/status", (ctx) => json(ctx, { status: "ok", framework: "Blaze" }));

router.get("/old-page", (ctx) => redirect(ctx, "/"));

serve({ port: 4001, router });
```

Compare the before and after:

```typescript
// Before (Step 3):
router.get("/", (ctx) => {
  ctx.setHeader("content-type", "text/html").setBody("<h1>Welcome!</h1>");
  return ctx;
});

// After (Step 4):
router.get("/", (ctx) => html(ctx, "<h1>Welcome!</h1>"));
```

Much cleaner. The helper handles status, content-type, body, and halting
in one call.

## How It Works

```
Handler: (ctx) => json(ctx, { status: "ok" })

  json(ctx, { status: "ok" })
    │
    ├── ctx.setStatus(200)
    ├── ctx.setHeader("content-type", "application/json")
    ├── ctx.setBody('{"status":"ok"}')       ← JSON.stringify
    ├── ctx.halt()                            ← stop pipeline
    └── return ctx
```

For redirect:

```
Handler: (ctx) => redirect(ctx, "/")

  redirect(ctx, "/")
    │
    ├── ctx.setStatus(302)
    ├── ctx.setHeader("location", "/")        ← browser follows this
    ├── ctx.setHeader("content-type", "text/html; charset=utf-8")
    ├── ctx.setBody("")                        ← empty body
    ├── ctx.halt()
    └── return ctx
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Test each response type

```bash
# HTML response
curl -i http://localhost:4001/
# Content-Type: text/html; charset=utf-8
# <h1>Welcome to Blaze!</h1>

# Plain text
curl http://localhost:4001/hello
# Hello, Blaze!

# JSON
curl http://localhost:4001/api/status
# {"status":"ok","framework":"Blaze"}

# Redirect (use -L to follow, or -i to see the 302)
curl -i http://localhost:4001/old-page
# HTTP/1.1 302 Found
# location: /
```

### 3. Test in browser

- Visit http://localhost:4001/ -- rendered HTML heading
- Visit http://localhost:4001/api/status -- JSON in the browser
- Visit http://localhost:4001/old-page -- automatically redirects to `/`

### 4. Try a custom status code

Add a route to `src/app.ts` to test error responses:

```typescript
router.get("/forbidden", (ctx) => text(ctx, "Access denied", 403));
```

```bash
curl -w "\nStatus: %{http_code}\n" http://localhost:4001/forbidden
# Access denied
# Status: 403
```

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/controller.ts` | **New** | text(), html(), json(), redirect() helpers |
| `src/app.ts` | **Modified** | Uses response helpers, adds JSON and redirect routes |

---

[← Previous: Step 3 - Router](03-router.md) | [Next: Step 5 - Dynamic Routes →](05-dynamic-routes.md)

## What's Next

Our routes only match exact paths like `/hello`. In **Step 5**, we'll add
**Dynamic Routes** -- patterns like `/users/:id` that extract parameters
from the URL, so `/users/42` sets `ctx.params.id = "42"`.
