# Step 9: Full HTTP Methods

[← Previous: Step 8 - POST Body Parser](08-post-body-parser.md) | [Next: Step 10 - JSON API →](10-json-api.md)

---

## What We're Building

We have `get()` and `post()`. REST APIs need all five standard HTTP
methods for CRUD operations:

| Method | Purpose | Example |
|---|---|---|
| GET | Read | `GET /users/42` |
| POST | Create | `POST /users` |
| PUT | Replace | `PUT /users/42` |
| PATCH | Partial update | `PATCH /users/42` |
| DELETE | Remove | `DELETE /users/42` |

In this step, we add `put()`, `patch()`, and `delete()` to the Router,
plus a private `addRoute()` helper to eliminate duplication.

### How This Compares to Ignite (Elixir)

In Elixir, each HTTP method has its own macro:

```elixir
get "/users/:id", to: UserController, action: :show
post "/users", to: UserController, action: :create
put "/users/:id", to: UserController, action: :update
patch "/users/:id", to: UserController, action: :update
delete "/users/:id", to: UserController, action: :delete
```

Each macro calls the same `build_route/4` function with a different method
string. Our approach is identical -- each method delegates to `addRoute()`.

## Concepts You'll Learn

### REST Convention

REST (Representational State Transfer) maps HTTP methods to CRUD operations
on resources:

```
GET    /users       → list all users
GET    /users/:id   → show one user
POST   /users       → create a user
PUT    /users/:id   → replace a user entirely
PATCH  /users/:id   → update specific fields
DELETE /users/:id   → delete a user
```

This is the same convention Phoenix uses with `resources/2`.

### DRY Route Registration

Instead of duplicating the route-pushing logic in each method:

```typescript
// Before: repetitive
get(path, handler) {
  this.routes.push({ method: "GET", path, segments: splitPath(path), handler });
}
post(path, handler) {
  this.routes.push({ method: "POST", path, segments: splitPath(path), handler });
}
```

We extract a private helper:

```typescript
// After: DRY
private addRoute(method, path, handler) {
  this.routes.push({ method, path, segments: splitPath(path), handler });
}
get(path, handler) { return this.addRoute("GET", path, handler); }
post(path, handler) { return this.addRoute("POST", path, handler); }
```

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Methods | `get`, `post`, `put`, `patch`, `delete` macros | `.get()`, `.post()`, etc. | `.get()`, `.post()`, etc. |
| Internal | `build_route/4` function | `addRoute()` private method | `addRoute()` private method |
| All CRUD | `resources "/users", UserController` | Individual method calls | Individual method calls |

## The Code

### `src/blaze/router.ts` -- All HTTP Methods

```typescript
export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];

  use(middleware: Middleware): this { ... }

  private addRoute(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, path, segments: splitPath(path), handler });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.addRoute("GET", path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.addRoute("POST", path, handler);
  }

  put(path: string, handler: Handler): this {
    return this.addRoute("PUT", path, handler);
  }

  patch(path: string, handler: Handler): this {
    return this.addRoute("PATCH", path, handler);
  }

  delete(path: string, handler: Handler): this {
    return this.addRoute("DELETE", path, handler);
  }

  async call(ctx: Context): Promise<Context> { ... }
}
```

**What changed:**

1. **`addRoute()` private method:** Centralizes the route-pushing logic.
   All public methods delegate to it.
2. **`put()`, `patch()`, `delete()`:** Three new public methods, each a
   one-liner delegating to `addRoute()`.

The `call()` method doesn't change -- it already matches on `route.method`,
so all five methods work with the existing dispatch logic.

### `src/app.ts` -- REST Demo Routes

```typescript
// REST demo (all HTTP methods on /echo)
router.put("/echo", (ctx) => json(ctx, { method: "PUT", received: ctx.body }));
router.patch("/echo", (ctx) => json(ctx, { method: "PATCH", received: ctx.body }));
router.delete("/echo", (ctx) => json(ctx, { method: "DELETE", deleted: true }));
```

The `/echo` endpoint now responds to all five HTTP methods.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Test all methods with curl

```bash
# GET (returns the form page)
curl -s http://localhost:4001/echo | head -1
# <h1>Echo POST</h1>

# POST
curl -s -X POST http://localhost:4001/echo \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
# {"received":{"name":"Alice"}}

# PUT
curl -s -X PUT http://localhost:4001/echo \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'
# {"method":"PUT","received":{"name":"Alice","email":"alice@example.com"}}

# PATCH
curl -s -X PATCH http://localhost:4001/echo \
  -H "Content-Type: application/json" \
  -d '{"email":"newemail@example.com"}'
# {"method":"PATCH","received":{"email":"newemail@example.com"}}

# DELETE
curl -s -X DELETE http://localhost:4001/echo
# {"method":"DELETE","deleted":true}
```

### 3. Quick test script

```bash
for method in GET POST PUT PATCH DELETE; do
  echo -n "$method → "
  curl -s -X $method http://localhost:4001/echo \
    -H "Content-Type: application/json" \
    -d '{"test":true}' | head -c 60
  echo
done
```

### 4. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/router.ts` | **Modified** | Added `addRoute()`, `put()`, `patch()`, `delete()` |
| `src/app.ts` | **Modified** | Added PUT/PATCH/DELETE demo routes on `/echo` |

---

[← Previous: Step 8 - POST Body Parser](08-post-body-parser.md) | [Next: Step 10 - JSON API →](10-json-api.md)

## What's Next

We have full HTTP method support. In **Step 10**, we'll build a proper
**JSON API** pattern with content-type negotiation, so the same route
can return HTML or JSON based on the `Accept` header.
