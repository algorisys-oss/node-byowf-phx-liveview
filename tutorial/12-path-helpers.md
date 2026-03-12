# Step 12: Path Helpers

[← Previous: Step 11 - Scoped Routes](11-scoped-routes.md) | [Next: Step 13 - Error Handler →](13-error-handler.md)

---

## What We're Building

Hardcoded URL strings are fragile. If you rename a route from `/users/:id`
to `/people/:id`, every hardcoded `"/users/42"` in your templates and
handlers silently breaks.

In this step, we add **named routes** and **path helpers** -- functions
that generate URL paths from route names and parameters:

```typescript
router.get("/users/:id", handler, "user");

router.pathFor("user", { id: 42 });  // → "/users/42"
```

### How This Compares to Ignite (Elixir)

In the Elixir version, path helpers are generated at compile-time using
`@before_compile` hooks and metaprogramming. Route names are derived
automatically from the path (e.g., `/users` → `user_path`), and helper
functions are generated as multiple clauses:

```elixir
def user_path(:show, id), do: "/users/" <> to_string(id)
```

In Blaze, we take a simpler runtime approach: routes get an optional
`name` parameter, and `pathFor()` looks up the route and substitutes
parameters at call time. No metaprogramming needed.

## Concepts You'll Learn

### Named Routes

Every route registration method now accepts an optional third argument --
a name string:

```typescript
router.get("/hello", handler, "hello");
router.post("/echo", handler, "echo_post");
```

Names are stored in a `Map<string, Route>` for O(1) lookup.

### pathFor() -- URL Generation

`pathFor()` takes a route name and optional parameters, then builds the
URL by replacing `:param` segments:

```typescript
router.pathFor("user", { id: 42 });
// Finds route with segments ["users", ":id"]
// Replaces ":id" with "42"
// Returns "/users/42"
```

This works with any number of dynamic segments:

```typescript
router.get("/posts/:postId/comments/:id", handler, "post_comment");

router.pathFor("post_comment", { postId: 7, id: 3 });
// → "/posts/7/comments/3"
```

### Scoped Named Routes

Named routes work correctly with scopes. The full path (including prefix)
is stored, so path generation includes the scope:

```typescript
router.scope("/api", (r) => {
  r.get("/users/:id", handler, "api_user");
});

router.pathFor("api_user", { id: 99 });
// → "/api/users/99"
```

### Route Listing

`getRoutes()` returns metadata about all registered routes -- useful for
debugging and for building route listing pages:

```typescript
router.getRoutes();
// [
//   { method: "GET", path: "/hello", name: "hello" },
//   { method: "GET", path: "/users/:id", name: "user" },
//   ...
// ]
```

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Naming | Auto-derived from path | Explicit `name` parameter | Explicit `name` parameter |
| Generation | Compile-time metaprogramming | Runtime `pathFor()` lookup | Runtime `pathFor()` lookup |
| Syntax | `user_path(:show, 42)` | `pathFor("user", { id: 42 })` | `pathFor("user", { id: 42 })` |
| Storage | Generated function clauses | `Map<string, Route>` | `Map<string, Route>` |
| Route listing | `mix phx.routes` | `router.getRoutes()` | `router.getRoutes()` |

## The Code

### `src/blaze/router.ts` -- Named Routes and Path Helpers

```typescript
interface Route {
  method: string;
  path: string;
  segments: string[];
  handler: Handler;
  name?: string;         // ← new: optional route name
}

export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];
  private prefix: string = "";
  private namedRoutes = new Map<string, Route>();  // ← new: name → route

  // ...

  private addRoute(method: string, path: string, handler: Handler, name?: string): this {
    const fullPath = this.prefix + path;
    const route: Route = { method, path: fullPath, segments: splitPath(fullPath), handler, name };
    this.routes.push(route);
    if (name) {
      this.namedRoutes.set(name, route);
    }
    return this;
  }

  get(path: string, handler: Handler, name?: string): this {
    return this.addRoute("GET", path, handler, name);
  }

  // post(), put(), patch(), delete() -- same signature change

  pathFor(name: string, params: Record<string, string | number> = {}): string {
    const route = this.namedRoutes.get(name);
    if (!route) {
      throw new Error(`No route named "${name}"`);
    }

    const segments = route.segments.map((seg) =>
      seg.startsWith(":") ? String(params[seg.slice(1)] ?? seg) : seg,
    );

    return "/" + segments.join("/");
  }

  getRoutes(): { method: string; path: string; name?: string }[] {
    return this.routes.map((r) => ({ method: r.method, path: r.path, name: r.name }));
  }

  // ...
}
```

**Key decisions:**

- **Explicit names:** Unlike Ignite which auto-derives names from paths,
  Blaze uses explicit name strings. This is simpler and avoids the need
  for singularization logic.
- **Optional naming:** Routes without names work exactly as before.
  `name` is an optional third argument.
- **Map storage:** Named routes are stored in a `Map` for O(1) lookup.
  The same route object lives in both `routes[]` and `namedRoutes`.
- **Error on missing name:** `pathFor()` throws if the name doesn't
  exist, catching typos immediately rather than generating wrong URLs.

### `src/app.ts` -- Named Routes and Route Listing Page

```typescript
router.get("/hello", (ctx) => text(ctx, "Hello, Blaze!"), "hello");

router.scope("/api", (r) => {
  r.get("/status", (ctx) => json(ctx, { ... }), "api_status");
  r.get("/users/:id", (ctx) => json(ctx, { ... }), "api_user");
});

router.get("/users/:id", (ctx) => { ... }, "user");
router.get("/posts/:postId/comments/:id", (ctx) => { ... }, "post_comment");
router.get("/profile/:id", (ctx) => { ... }, "profile");

// Route listing + path helper demo
router.get("/routes", (ctx) => {
  const routes = router.getRoutes();
  const examples = [
    `pathFor("hello") → ${router.pathFor("hello")}`,
    `pathFor("user", { id: 42 }) → ${router.pathFor("user", { id: 42 })}`,
    `pathFor("api_user", { id: 99 }) → ${router.pathFor("api_user", { id: 99 })}`,
    `pathFor("post_comment", { postId: 7, id: 3 }) → ${router.pathFor("post_comment", { postId: 7, id: 3 })}`,
  ];
  // ... render HTML table of routes + examples
}, "routes");
```

## How It Works

```
1. Registration:
   router.get("/users/:id", handler, "user")
   → stores Route { segments: ["users", ":id"], name: "user" }
   → namedRoutes.set("user", route)

2. Path generation:
   router.pathFor("user", { id: 42 })
   → lookup "user" in namedRoutes → found
   → map segments: ["users", ":id"] → ["users", "42"]
   → join: "/users/42"

3. Scoped routes:
   scope("/api") + get("/users/:id", handler, "api_user")
   → fullPath = "/api/users/:id"
   → segments: ["api", "users", ":id"]
   → pathFor("api_user", { id: 99 }) → "/api/users/99"
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the route listing page

Visit http://localhost:4001/routes to see all registered routes and
path helper examples.

### 3. Test path generation

```bash
curl http://localhost:4001/routes
# HTML page with route table and pathFor() examples
```

You should see a table of all routes with their methods, paths, and names,
plus path helper examples like:
- `pathFor("hello") → /hello`
- `pathFor("user", { id: 42 }) → /users/42`
- `pathFor("api_user", { id: 99 }) → /api/users/99`

### 4. Verify named routes still work for requests

```bash
curl http://localhost:4001/hello
# Hello, Blaze!

curl http://localhost:4001/api/users/42
# {"user":{"id":"42","name":"User 42"}}
```

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **Modified** | Added `name` param, `namedRoutes` Map, `pathFor()`, `getRoutes()` |
| `src/app.ts` | **Modified** | Named routes, `/routes` listing page with path helper demos |

---

[← Previous: Step 11 - Scoped Routes](11-scoped-routes.md) | [Next: Step 13 - Error Handler →](13-error-handler.md)

## What's Next

In **Step 13**, we'll add an **Error Handler** -- a try/catch boundary
around route dispatch that catches exceptions and returns a proper 500
error page, with different output for development vs production.
