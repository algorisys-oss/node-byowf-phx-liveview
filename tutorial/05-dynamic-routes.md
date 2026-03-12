# Step 5: Dynamic Routes

[← Previous: Step 4 - Response Helpers](04-response-helpers.md) | [Next: Step 6 - Template Engine →](06-template-engine.md)

---

## What We're Building

So far, our router only matches **exact** paths: `/hello` matches `/hello`
but nothing else. Real web applications need routes like `/users/42` or
`/posts/7/comments/3`, where parts of the URL are **dynamic parameters**.

In this step, we add `:param` patterns to the router. A route like
`/users/:id` will match `/users/42` and set `ctx.params.id = "42"`.

### How This Compares to Ignite (Elixir)

In Elixir, dynamic segments use the same `:param` syntax:

```elixir
get "/users/:id", to: UserController, action: :show
```

At compile time, this becomes a pattern-matching clause:

```elixir
defp dispatch(%Conn{method: "GET"} = conn, ["users", id]) do
  # id is bound by pattern matching
end
```

The BEAM VM matches `["users", "42"]` against `["users", id]`, binding
`id = "42"` automatically.

In Node.js, we implement the same logic at runtime: split both the route
pattern and the request path into segments, compare them one by one,
and capture `:param` segments into `ctx.params`.

## Concepts You'll Learn

### Path Segments

URLs are split into segments by `/`:

```
/users/42/posts  →  ["users", "42", "posts"]
/                →  []
/hello           →  ["hello"]
```

This is what Elixir does with `String.split(path, "/", trim: true)`.
In TypeScript: `path.split("/").filter(Boolean)`.

### Segment Matching

Each segment in the route pattern is compared against the corresponding
segment in the request path:

| Route Segment | Path Segment | Result |
|---|---|---|
| `"users"` | `"users"` | Match (literal) |
| `":id"` | `"42"` | Match (capture `id = "42"`) |
| `"posts"` | `"comments"` | No match |

A route matches if:
1. Both have the **same number** of segments
2. Every segment either matches literally or is a `:param` capture

### Pre-compiled Segments

When you call `router.get("/users/:id", handler)`, we split the path into
segments immediately (`["users", ":id"]`) and store them on the route.
This avoids re-parsing the route pattern on every request.

### Why All Params Are Strings

URL segments are always strings. If your route is `/users/:id` and the
request is `/users/42`, `ctx.params.id` is `"42"` (string), not `42`
(number). Parsing to the right type is the handler's responsibility:

```typescript
const id = parseInt(ctx.params.id, 10);
```

This matches Phoenix's behavior -- `conn.params["id"]` is always a string.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun/Node.js (Blaze) |
|---|---|---|
| Dynamic syntax | `:id` in path string | `:id` in path string |
| Matching | Compile-time pattern match on list | Runtime segment comparison loop |
| Param access | `conn.params["id"]` | `ctx.params.id` |
| Segment split | `String.split(path, "/", trim: true)` | `path.split("/").filter(Boolean)` |
| Pre-compilation | Macro expands to function clauses | Segments stored at registration |
| Param types | Always strings | Always strings |

## The Code

### `src/blaze/router.ts` -- Updated with Dynamic Matching

```typescript
import type { Context } from "./context.js";

export type Handler = (ctx: Context) => Context | Promise<Context>;

interface Route {
  method: string;
  path: string;
  segments: string[];
  handler: Handler;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function matchRoute(
  routeSegments: string[],
  pathSegments: string[],
): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i]!;
    const pathSeg = pathSegments[i]!;

    if (routeSeg.startsWith(":")) {
      params[routeSeg.slice(1)] = pathSeg;
    } else if (routeSeg !== pathSeg) {
      return null;
    }
  }

  return params;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, segments: splitPath(path), handler });
    return this;
  }

  async call(ctx: Context): Promise<Context> {
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

**What changed from Step 3:**

1. **`Route.path` kept for reference, `Route.segments` added:** Routes
   store pre-split segments for matching. The original `path` is kept for
   debugging/logging.
2. **`splitPath()` helper:** Splits a path into segments, filtering out
   empty strings (from leading/trailing slashes).
3. **`matchRoute()` function:** The core matching logic. Compares route
   segments against path segments one by one. Returns a params object on
   match, `null` on mismatch.
4. **`call()` uses segment matching:** Instead of `route.path === ctx.path`,
   we split the request path and call `matchRoute()`.
5. **Params are set on context:** `ctx.params = params` before calling the
   handler.

**Key decisions:**

- **Early length check:** `matchRoute()` returns `null` immediately if
  segment counts differ. This is the cheapest possible rejection.
- **`:param` detection:** A segment starting with `:` is a dynamic
  parameter. The `:` is stripped when storing in params.
- **Non-null assertions (`!`):** We've already checked array lengths match,
  so `routeSegments[i]!` is safe.

### `src/app.ts` -- Updated with Dynamic Routes

```typescript
import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";
import { text, html, json, redirect } from "./blaze/controller.js";

const router = new Router();

router.get("/", (ctx) =>
  html(
    ctx,
    `<h1>Welcome to Blaze!</h1>
<p>A Phoenix-like framework for Node.js</p>
<h2>Routes to try:</h2>
<ul>
  <li><a href="/hello">/hello</a> — plain text</li>
  <li><a href="/api/status">/api/status</a> — JSON response</li>
  <li><a href="/users/42">/users/42</a> — dynamic route (single param)</li>
  <li><a href="/users/99">/users/99</a> — dynamic route (different id)</li>
  <li><a href="/posts/7/comments/3">/posts/7/comments/3</a> — multi-param route</li>
  <li><a href="/greet/world">/greet/world</a> — greeting with param</li>
  <li><a href="/old-page">/old-page</a> — redirect to /</li>
  <li><a href="/nope">/nope</a> — 404 page</li>
</ul>`,
  ),
);

router.get("/hello", (ctx) => text(ctx, "Hello, Blaze!"));

router.get("/api/status", (ctx) => json(ctx, { status: "ok", framework: "Blaze" }));

router.get("/old-page", (ctx) => redirect(ctx, "/"));

router.get("/users/:id", (ctx) =>
  json(ctx, { user: { id: ctx.params.id, name: `User ${ctx.params.id}` } }),
);

router.get("/posts/:postId/comments/:id", (ctx) =>
  json(ctx, { postId: ctx.params.postId, commentId: ctx.params.id }),
);

router.get("/greet/:name", (ctx) => text(ctx, `Hello, ${ctx.params.name}!`));

serve({ port: 4001, router });
```

The landing page now shows clickable links to all available routes.

## How It Works

```
Request: GET /users/42

splitPath("/users/42")  →  ["users", "42"]

Route: GET /users/:id
  segments: ["users", ":id"]

matchRoute(["users", ":id"], ["users", "42"]):
  i=0: "users" === "users"     → literal match ✓
  i=1: ":id" starts with ":"   → capture id = "42" ✓
  → return { id: "42" }

ctx.params = { id: "42" }
handler(ctx)  →  json(ctx, { user: { id: "42", name: "User 42" } })
```

For a multi-param route:

```
Request: GET /posts/7/comments/3

Route: GET /posts/:postId/comments/:id
  segments: ["posts", ":postId", "comments", ":id"]

matchRoute(["posts", ":postId", "comments", ":id"], ["posts", "7", "comments", "3"]):
  i=0: "posts" === "posts"           → literal match ✓
  i=1: ":postId" → capture postId=7  ✓
  i=2: "comments" === "comments"     → literal match ✓
  i=3: ":id" → capture id=3          ✓
  → return { postId: "7", id: "3" }
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the landing page

Open http://localhost:4001/ -- you'll see clickable links to test all routes.

### 3. Test dynamic routes

```bash
# Single param
curl http://localhost:4001/users/42
# {"user":{"id":"42","name":"User 42"}}

curl http://localhost:4001/users/99
# {"user":{"id":"99","name":"User 99"}}

# Multiple params
curl http://localhost:4001/posts/7/comments/3
# {"postId":"7","commentId":"3"}

# Param in text
curl http://localhost:4001/greet/world
# Hello, world!

# Static routes still work
curl http://localhost:4001/hello
# Hello, Blaze!

# No match (wrong segment count)
curl -w "\nStatus: %{http_code}\n" http://localhost:4001/users
# 404 - Not Found
# Status: 404
```

### 4. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **Modified** | Segment-based matching with `:param` capture |
| `src/app.ts` | **Modified** | Dynamic routes, landing page with links |

---

[← Previous: Step 4 - Response Helpers](04-response-helpers.md) | [Next: Step 6 - Template Engine →](06-template-engine.md)

## What's Next

We can route requests and send responses, but our HTML is all inline
strings. In **Step 6**, we'll build a **Template Engine** using file-based
templates with variable interpolation, so we can separate HTML from
TypeScript code.
