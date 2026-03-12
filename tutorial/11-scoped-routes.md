# Step 11: Scoped Routes

[← Previous: Step 10 - JSON API](10-json-api.md) | [Next: Step 12 - Path Helpers →](12-path-helpers.md)

---

## What We're Building

As an application grows, routes naturally group under shared prefixes:

```
/api/users
/api/users/:id
/api/posts
/api/posts/:id
```

Writing `/api` in every route is repetitive. In this step, we add
`scope()` -- a method that groups routes under a shared prefix:

```typescript
router.scope("/api", (r) => {
  r.get("/users", handler);     // → /api/users
  r.get("/users/:id", handler); // → /api/users/:id
});
```

### How This Compares to Ignite (Elixir)

In Phoenix, `scope` is a macro that sets a path prefix for all routes
defined inside:

```elixir
scope "/api" do
  get "/users", UserController, :index
  get "/users/:id", UserController, :show
end
```

In Blaze, `scope()` is a method that temporarily sets a prefix on the
router, calls a callback, then restores the previous prefix. Same effect,
runtime instead of compile-time.

## Concepts You'll Learn

### Scope as Temporary State

The implementation is elegant: `scope()` saves the current prefix, sets
the new one (appending to any existing prefix), calls the callback, then
restores the old prefix:

```typescript
scope(prefix, fn) {
  const prev = this.prefix;
  this.prefix = prev + prefix;
  fn(this);
  this.prefix = prev;
}
```

This means scopes can **nest**:

```typescript
router.scope("/api", (r) => {
  r.scope("/v2", (r2) => {
    r2.get("/health", handler); // → /api/v2/health
  });
});
```

### Route Registration with Prefix

The `addRoute()` method prepends the current prefix to every path:

```typescript
private addRoute(method, path, handler) {
  const fullPath = this.prefix + path;
  this.routes.push({ method, path: fullPath, segments: splitPath(fullPath), handler });
}
```

Routes defined outside any scope have an empty prefix (no change).

### Callback Pattern

The callback receives the router itself, so you call route methods on it:

```typescript
router.scope("/admin", (r) => {
  r.get("/dashboard", dashboardHandler);
  r.post("/settings", settingsHandler);
});
```

This is the same pattern Phoenix uses with its `do...end` block, just
expressed as a JavaScript callback.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Phoenix) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Syntax | `scope "/api" do ... end` | `router.scope("/api", (r) => { ... })` | `router.scope("/api", (r) => { ... })` |
| Nesting | Scopes nest inside scopes | Scopes nest via prefix concatenation | Scopes nest via prefix concatenation |
| Mechanism | Compile-time macro | Runtime prefix + callback | Runtime prefix + callback |
| Route methods | `get`, `post`, etc. inside block | `r.get()`, `r.post()` on callback param | `r.get()`, `r.post()` on callback param |

## The Code

### `src/blaze/router.ts` -- Updated with `scope()`

```typescript
export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];
  private prefix: string = "";

  // ...

  scope(prefix: string, fn: (router: Router) => void): this {
    const prev = this.prefix;
    this.prefix = prev + prefix;
    fn(this);
    this.prefix = prev;
    return this;
  }

  private addRoute(method: string, path: string, handler: Handler): this {
    const fullPath = this.prefix + path;
    this.routes.push({ method, path: fullPath, segments: splitPath(fullPath), handler });
    return this;
  }

  // ... get(), post(), etc. unchanged ...
}
```

**Key decisions:**

- **`prefix` field:** Starts empty. `scope()` modifies it temporarily.
- **Save/restore pattern:** The previous prefix is saved and restored
  after the callback. This enables nesting without corruption.
- **Prefix concatenation:** Nested scopes concatenate:
  `"/api"` + `"/v2"` = `"/api/v2"`.
- **Same router instance:** The callback receives `this`, not a new
  router. All routes go into the same flat array -- scopes are purely
  a registration-time convenience.

### `src/app.ts` -- Scoped API Routes

```typescript
// Scoped API routes
router.scope("/api", (r) => {
  r.get("/status", (ctx) => json(ctx, { status: "ok", framework: "Blaze" }));

  r.get("/users/:id", (ctx) =>
    json(ctx, { user: { id: ctx.params.id, name: `User ${ctx.params.id}` } }),
  );
});
```

The `/api/status` route that was previously defined as
`router.get("/api/status", ...)` is now inside a scope. The `/api/users/:id`
route is a new JSON-only API endpoint (separate from the content-negotiating
`/users/:id`).

## How It Works

```
router.scope("/api", (r) => {
  r.get("/status", handler);     // prefix = "/api" → fullPath = "/api/status"
  r.get("/users/:id", handler);  // prefix = "/api" → fullPath = "/api/users/:id"
});
// prefix restored to ""

router.get("/hello", handler);   // prefix = "" → fullPath = "/hello"
```

At request time, routing works identically -- the stored segments already
include the prefix. There's no runtime overhead from scoping.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Test scoped routes

```bash
curl http://localhost:4001/api/status
# {"status":"ok","framework":"Blaze"}

curl http://localhost:4001/api/users/42
# {"user":{"id":"42","name":"User 42"}}
```

### 3. Verify unscoped path returns 404

```bash
curl -w "\nStatus: %{http_code}\n" http://localhost:4001/status
# 404 - Not Found
# Status: 404
```

### 4. Try nested scopes

Add this to your app:

```typescript
router.scope("/api", (r) => {
  r.scope("/v1", (r1) => {
    r1.get("/users", handler);  // → /api/v1/users
  });
  r.scope("/v2", (r2) => {
    r2.get("/users", handler);  // → /api/v2/users
  });
});
```

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **Modified** | Added `scope()`, `prefix` field, prefix in `addRoute()` |
| `src/app.ts` | **Modified** | API routes grouped under `scope("/api")` |

---

[← Previous: Step 10 - JSON API](10-json-api.md) | [Next: Step 12 - Path Helpers →](12-path-helpers.md)

## What's Next

In **Step 12**, we'll add **Path Helpers** -- functions that generate
URL paths from route names and parameters, like Phoenix's
`Routes.user_path(conn, :show, 42)` → `"/users/42"`.
