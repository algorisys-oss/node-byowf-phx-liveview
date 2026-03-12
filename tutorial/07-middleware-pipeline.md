# Step 7: Middleware Pipeline

[← Previous: Step 6 - Template Engine](06-template-engine.md) | [Next: Step 8 - POST Body Parser →](08-post-body-parser.md)

---

## What We're Building

Every real web framework needs a way to run shared logic before (or after)
route handlers -- logging, authentication, CORS headers, rate limiting.
In Phoenix, these are called **plugs**. In Express, they're **middleware**.

In this step, we add a middleware pipeline to the Router. Middleware
functions run in order before route dispatch. Any middleware can halt the
pipeline to short-circuit processing (e.g., return 401 Unauthorized
without ever reaching the route handler).

### How This Compares to Ignite (Elixir)

In Elixir, plugs are registered with a `plug :function_name` macro:

```elixir
plug :log_request
plug :authenticate
plug :rate_limit
```

At compile time, these accumulate into a module attribute. At runtime,
`Enum.reduce` transforms the conn through each plug sequentially,
skipping the rest if `conn.halted` is true.

In Blaze, `router.use(fn)` registers middleware functions in an array.
The `call()` method loops through them before dispatching to a route.
Same pattern, runtime instead of compile-time.

## Concepts You'll Learn

### The Plug/Middleware Pattern

A middleware function receives a Context and returns a Context:

```typescript
function logger(ctx: Context): Context {
  console.log(`${ctx.method} ${ctx.path}`);
  return ctx;
}
```

Middleware can:
- **Inspect** the request (logging, timing)
- **Modify** the context (add headers, set private state)
- **Halt** the pipeline (authentication, rate limiting)

### Pipeline Execution Order

Middleware runs in registration order, before routing:

```
Request → [middleware 1] → [middleware 2] → [router dispatch] → Response
```

If middleware 2 halts:

```
Request → [middleware 1] → [middleware 2 ← HALT] → Response
                           (router never runs)
```

### Halting the Pipeline

When a middleware calls `ctx.halt()` (usually via a response helper like
`text(ctx, "Unauthorized", 401)`), the pipeline stops. No further
middleware runs, and route dispatch is skipped.

This is how Phoenix's CSRF plug works -- if the token is invalid, it
returns a 403 response and halts, preventing the controller from executing.

### `use()` vs `get()`

- **`use(middleware)`** -- runs on EVERY request, before routing
- **`get("/path", handler)`** -- runs only when method + path match

In Phoenix terms, `use()` is like `plug` and `get()` is like a route
definition.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Register | `plug :function_name` (macro) | `router.use(fn)` | `router.use(fn)` |
| Storage | Module attribute `@plugs` | `middlewares[]` array | `middlewares[]` array |
| Execution | `Enum.reduce(plugs, conn, ...)` | `for` loop | `for` loop |
| Halt check | `if acc.halted, do: acc` | `if (ctx.halted) return ctx` | `if (ctx.halted) return ctx` |
| Signature | `def mw(conn), do: conn` | `(ctx: Context) => Context` | `(ctx: Context) => Context` |
| Order | Top-to-bottom in module | Registration order | Registration order |
| Async support | N/A (processes) | `instanceof Promise` check | `instanceof Promise` check |

## The Code

### `src/blaze/router.ts` -- Updated with Middleware

```typescript
import type { Context } from "./context.js";

export type Handler = (ctx: Context) => Context | Promise<Context>;
export type Middleware = (ctx: Context) => Context | Promise<Context>;

interface Route {
  method: string;
  path: string;
  segments: string[];
  handler: Handler;
}

// ... splitPath() and matchRoute() unchanged ...

export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, segments: splitPath(path), handler });
    return this;
  }

  async call(ctx: Context): Promise<Context> {
    // Run middleware pipeline
    for (const mw of this.middlewares) {
      const result = mw(ctx);
      ctx = result instanceof Promise ? await result : result;
      if (ctx.halted) return ctx;
    }

    // Route dispatch
    const pathSegments = splitPath(ctx.path);

    for (const route of this.routes) {
      if (route.method !== ctx.method) continue;

      const params = matchRoute(route.segments, pathSegments);
      if (params) {
        ctx.params = params;
        const result = route.handler(ctx);
        return result instanceof Promise ? await result : result;
      }
    }

    // 404 fallback
    ctx.setStatus(404).setHeader("content-type", "text/plain").setBody("404 - Not Found");
    return ctx;
  }
}
```

**What changed from Step 5:**

1. **`Middleware` type:** Same signature as `Handler` -- receives and
   returns a Context. Middleware and handlers are the same shape.
2. **`middlewares` array:** Stores registered middleware functions.
3. **`use()` method:** Pushes middleware onto the array. Returns `this`
   for chaining.
4. **Pipeline in `call()`:** Before routing, loops through all middleware.
   After each middleware, checks `ctx.halted`. If halted, returns immediately.

**Key decisions:**

- **Middleware mutates `ctx`:** The `for` loop reassigns `ctx` from each
  middleware's return value. This lets middleware replace the context if
  needed (though in practice they modify and return the same one).
- **Sync/async transparent:** The `instanceof Promise` check handles both
  sync and async middleware without requiring everything to be async.
- **Middleware before routes:** All middleware runs on every request,
  including 404s. This matches Phoenix's behavior.

### `src/blaze/server.ts` -- Simplified

The server no longer has `console.log` -- that's now a middleware concern.
The server just creates the Context, calls the router, and sends the response.

```typescript
import { createServer, type Server } from "node:http";
import { Context } from "./context.js";
import type { Router } from "./router.js";

export interface ServeOptions {
  port?: number;
  router?: Router;
}

export function serve(options: ServeOptions = {}): Server {
  const port = options.port ?? 4001;
  const router = options.router;

  const server = createServer(async (req, res) => {
    const ctx = new Context(req, res);

    if (router) {
      await router.call(ctx);
      ctx.send();
      return;
    }

    ctx
      .setStatus(200)
      .setHeader("content-type", "text/plain")
      .setBody("Hello, Blaze!");

    ctx.send();
  });

  server.listen(port, () => {
    console.log(`Blaze is heating up on http://localhost:${port}`);
  });

  return server;
}
```

### `src/app.ts` -- Demo Middleware

```typescript
import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";
import { text, html, json, redirect, render } from "./blaze/controller.js";

const router = new Router();

// -- Middleware --

// Log every request
router.use((ctx) => {
  console.log(`${ctx.method} ${ctx.path}`);
  return ctx;
});

// Add X-Powered-By header to every response
router.use((ctx) => {
  ctx.setHeader("x-powered-by", "Blaze");
  return ctx;
});

// Request timing (store start time in private state)
router.use((ctx) => {
  ctx.putPrivate("startTime", performance.now());
  return ctx;
});

// -- Routes --
// ... routes unchanged from Step 6 ...

serve({ port: 4001, router });
```

Three middleware examples:
- **Logger:** Prints method and path for every request
- **Powered-By header:** Added to every response (like Phoenix's
  `add_server_header` plug)
- **Request timing:** Stores start time in private state. A later step
  will use this to log response times.

## How It Works

```
Request: GET /hello

router.call(ctx):
  │
  ├── Middleware 1: console.log("GET /hello")
  │   └── ctx.halted? false → continue
  │
  ├── Middleware 2: setHeader("x-powered-by", "Blaze")
  │   └── ctx.halted? false → continue
  │
  ├── Middleware 3: putPrivate("startTime", 1234.5)
  │   └── ctx.halted? false → continue
  │
  └── Route dispatch:
      ├── GET /hello → match!
      └── handler(ctx) → text(ctx, "Hello, Blaze!")

Response: 200 OK
  x-powered-by: Blaze
  Hello, Blaze!
```

With a halting middleware (e.g., auth check on `/admin`):

```
Request: GET /admin/dashboard

router.call(ctx):
  │
  ├── Middleware 1: console.log("GET /admin/dashboard")
  │   └── ctx.halted? false → continue
  │
  ├── Middleware 2: setHeader("x-powered-by", "Blaze")
  │   └── ctx.halted? false → continue
  │
  ├── Middleware 3: putPrivate("startTime", ...)
  │   └── ctx.halted? false → continue
  │
  ├── Middleware 4: path starts with "/admin" → text(ctx, "Unauthorized", 401)
  │   └── ctx.halted? true → STOP
  │
  └── (route dispatch never runs)

Response: 401 Unauthorized
  x-powered-by: Blaze
  Unauthorized
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Check the X-Powered-By header

```bash
curl -i http://localhost:4001/hello
# HTTP/1.1 200 OK
# x-powered-by: Blaze
# content-type: text/plain
# Hello, Blaze!
```

Every response includes the `x-powered-by` header from middleware.

### 3. Check the logger

In the terminal where the server is running, you should see:

```
GET /hello
```

### 4. Try adding auth middleware

Add this before your routes in `src/app.ts`:

```typescript
router.use((ctx) => {
  if (ctx.path.startsWith("/admin")) {
    const auth = ctx.headers["authorization"];
    if (auth !== "Bearer secret123") {
      return text(ctx, "Unauthorized", 401);
    }
  }
  return ctx;
});
```

Test:

```bash
# Without auth
curl -w "\nStatus: %{http_code}\n" http://localhost:4001/admin/dashboard
# Unauthorized
# Status: 401

# With auth
curl -H "Authorization: Bearer secret123" http://localhost:4001/admin/dashboard
# 404 - Not Found (no route defined, but auth passed!)
```

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **Modified** | Added `use()`, `Middleware` type, pipeline in `call()` |
| `src/blaze/server.ts` | **Modified** | Removed console.log (now a middleware concern) |
| `src/app.ts` | **Modified** | Added demo middleware (logger, powered-by, timing) |

---

[← Previous: Step 6 - Template Engine](06-template-engine.md) | [Next: Step 8 - POST Body Parser →](08-post-body-parser.md)

## What's Next

We can handle GET requests with middleware, routing, and templates. In
**Step 8**, we'll add **POST Body Parsing** -- reading form submissions
and JSON request bodies from `IncomingMessage` so we can handle user input.
