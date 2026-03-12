# Step 3: Router

[← Previous: Step 2 - Context Object](02-context-object.md) | [Next: Step 4 - Response Helpers →](04-response-helpers.md)

---

## What We're Building

In Step 2, every URL returned the same response. A real web framework needs
to map different URLs to different handlers:

- `GET /` → welcome page
- `GET /hello` → greeting text
- `GET /anything-else` → 404 Not Found

In this step, we build a **Router** -- a class that registers routes and
matches incoming requests to the right handler function.

### How This Compares to Ignite (Elixir)

In Elixir, the router uses **macros** that compile into pattern-matching
function clauses at compile time:

```elixir
get "/", to: WelcomeController, action: :index
```

This becomes a `dispatch/2` function clause that the BEAM VM matches
against at runtime. Elixir's compile-time metaprogramming makes this
extremely efficient.

In Node.js/TypeScript, we don't have macros. Instead, we use a
**function-based DSL** -- you call `router.get("/path", handler)` to
register routes, and the router iterates through them at runtime to find
a match. The API feels similar, but the mechanism is different.

## Concepts You'll Learn

### Route Registration

Routes are registered by calling methods on a `Router` instance:

```typescript
const router = new Router();

router.get("/", homeHandler);
router.get("/hello", helloHandler);
```

Each call stores a `{ method, path, handler }` tuple in an array. The
router checks these in order when a request arrives.

### Handler Functions

A handler receives a `Context` and returns a `Context` (or `Promise<Context>`
for async handlers):

```typescript
const homeHandler = (ctx: Context) => {
  ctx.setHeader("content-type", "text/html").setBody("<h1>Home</h1>");
  return ctx;
};
```

This is the same pattern as Elixir controllers:

```elixir
def index(conn) do
  html(conn, "<h1>Home</h1>")
end
```

The handler reads from the context (request data) and writes to it
(response data), then returns it for the next step in the pipeline.

### Route Matching

When a request arrives, the router compares the request's method and path
against each registered route in order. The first match wins.

```
Request: GET /hello

Route 1: GET /       → no match (path differs)
Route 2: GET /hello  → match! → call handler
```

If no route matches, the router returns a 404 response.

### Async Handlers

Handlers can be async (returning `Promise<Context>`). The server awaits
the result before sending the response. This will be important when we
add database queries and other async operations later.

```typescript
router.get("/data", async (ctx) => {
  const data = await fetchFromDB();  // async operation
  ctx.setBody(JSON.stringify(data));
  return ctx;
});
```

### The `instanceof Promise` Pattern

When calling a handler, we don't know if it returns `Context` or
`Promise<Context>`. Instead of always using `await` (which adds overhead
for sync handlers), we check at runtime:

```typescript
const result = handler(ctx);
return result instanceof Promise ? await result : result;
```

This keeps sync handlers fast while supporting async ones.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Route definition | `get "/path", to: Ctrl` (macro) | `router.get("/path", handler)` | `router.get("/path", handler)` |
| Matching | Compile-time pattern matching | Runtime loop | Runtime loop |
| Handler signature | `def action(conn)` | `(ctx) => Context` | `(ctx) => Context` |
| Async support | BEAM processes | `async`/`await` | `async`/`await` |
| 404 fallback | `finalize_routes()` catch-all | Fall-through after loop | Fall-through after loop |
| Route storage | Compiled function clauses | Array of tuples | Array of tuples |

## The Code

### `src/blaze/router.ts` -- The Router

```typescript
/**
 * Blaze Router -- Route registration and matching.
 *
 * Equivalent to Ignite.Router in the Elixir version.
 * Function-based DSL instead of macros: router.get("/path", handler).
 * Linear scan matching on method + path, with 404 fallback.
 */

import type { Context } from "./context.js";

export type Handler = (ctx: Context) => Context | Promise<Context>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, handler });
    return this;
  }

  async call(ctx: Context): Promise<Context> {
    for (const route of this.routes) {
      if (route.method === ctx.method && route.path === ctx.path) {
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

**Key decisions:**

- **`Handler` type:** `(ctx: Context) => Context | Promise<Context>`.
  Handlers can be sync or async. The union type keeps sync handlers simple
  while allowing async when needed.
- **`Route` interface:** A simple tuple of method, path, and handler.
  No controller/action separation yet -- that's an unnecessary abstraction
  at this stage.
- **`get()` returns `this`:** Enables chaining:
  `router.get("/", home).get("/hello", hello)`.
- **Only `get()` for now:** We'll add `post()`, `put()`, `patch()`,
  `delete()` in Step 9.
- **Linear scan matching:** Simple O(n) loop. For a tutorial framework
  this is fine -- even Phoenix's compiled pattern matching is doing the
  same thing conceptually, just faster.
- **404 is built-in:** No need for a separate `finalize_routes()` call.
  If no route matches, it's a 404.
- **`call()` is async:** Even though most handlers are sync, the method
  is async to simplify handling the sync/async union.

### `src/blaze/server.ts` -- Updated to Accept a Router

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

    console.log(`${ctx.method} ${ctx.path}`);

    if (router) {
      await router.call(ctx);
      ctx.send();
      return;
    }

    // Default response when no router is configured
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

**What changed from Step 2:**

1. `ServeOptions` now accepts an optional `router`
2. The `createServer` callback is now `async` to support async handlers
3. If a router is provided, all requests go through `router.call(ctx)`
4. After the router processes the context, we call `ctx.send()`
5. Fallback "Hello, Blaze!" response remains for backward compatibility

### `src/app.ts` -- Application with Routes

```typescript
import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";

const router = new Router();

router.get("/", (ctx) => {
  ctx.setHeader("content-type", "text/html").setBody("<h1>Welcome to Blaze!</h1>");
  return ctx;
});

router.get("/hello", (ctx) => {
  ctx.setHeader("content-type", "text/plain").setBody("Hello, Blaze!");
  return ctx;
});

serve({ port: 4001, router });
```

Clean separation: the framework provides `Router`, the application defines
routes and handlers.

## How It Works

```
Browser: GET /hello

Server (createServer callback)
  │
  ├─ new Context(req, res)        ctx.method = "GET", ctx.path = "/hello"
  │
  └─ router.call(ctx)
       │
       ├─ Route: GET /            → no match
       ├─ Route: GET /hello       → match!
       │    └─ handler(ctx)       → ctx.setBody("Hello, Blaze!")
       │
       └─ return ctx

  ctx.send()                      → res.writeHead(200) + res.end("Hello, Blaze!")
```

For an unmatched path like `/nope`:

```
  router.call(ctx)
       │
       ├─ Route: GET /            → no match
       ├─ Route: GET /hello       → no match
       │
       └─ 404 fallback            → ctx.setStatus(404).setBody("404 - Not Found")
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the routes

- http://localhost:4001/ → **Welcome to Blaze!** (HTML heading)
- http://localhost:4001/hello → **Hello, Blaze!** (plain text)
- http://localhost:4001/anything → **404 - Not Found**

### 3. Test with curl

```bash
# Root route
curl http://localhost:4001/
# <h1>Welcome to Blaze!</h1>

# Hello route
curl http://localhost:4001/hello
# Hello, Blaze!

# 404
curl -w "\nStatus: %{http_code}\n" http://localhost:4001/nope
# 404 - Not Found
# Status: 404
```

### 4. Add a new route

Try adding a route to `src/app.ts`:

```typescript
router.get("/about", (ctx) => {
  ctx.setHeader("content-type", "text/html")
    .setBody("<h1>About</h1><p>Blaze -- a Phoenix-like framework for Node.js</p>");
  return ctx;
});
```

Restart the server and visit http://localhost:4001/about.

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **New** | Router with route registration and matching |
| `src/blaze/server.ts` | **Modified** | Accepts optional router, async callback |
| `src/app.ts` | **Modified** | Defines routes for `/` and `/hello` |

---

[← Previous: Step 2 - Context Object](02-context-object.md) | [Next: Step 4 - Response Helpers →](04-response-helpers.md)

## What's Next

Our handlers are setting headers manually every time
(`setHeader("content-type", ...)`). In **Step 4**, we'll create
**Response Helpers** -- `text()`, `html()`, `json()`, and `redirect()`
functions that set the right content-type and status automatically,
just like Phoenix's controller helpers.
