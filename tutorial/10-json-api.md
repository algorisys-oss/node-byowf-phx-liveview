# Step 10: JSON API

[← Previous: Step 9 - Full HTTP Methods](09-full-http-methods.md) | [Next: Step 11 - Scoped Routes →](11-scoped-routes.md)

---

## What We're Building

We already have `json()` for sending JSON responses and body parsing for
receiving JSON. The missing piece is **content-type negotiation** -- letting
the same route return HTML for browsers and JSON for API clients, based
on the request's `Accept` header.

In this step, we add:

1. **`accepts()`** method on Context to check what the client wants
2. A demo route that negotiates between HTML and JSON

### How This Compares to Ignite (Elixir)

Phoenix has a powerful content negotiation system via `plug :accepts` and
the `Phoenix.Controller.accepts/2` function. Routes can render different
formats from the same controller action.

In Blaze, we keep it simpler: `ctx.accepts("application/json")` checks
if the client's `Accept` header includes that media type. Handlers use
this to branch their response format.

## Concepts You'll Learn

### The Accept Header

When a browser makes a request, it sends an `Accept` header saying what
content types it can handle:

```
Accept: text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8
```

An API client like `fetch()` or `curl` might send:

```
Accept: application/json
```

### Content Negotiation Pattern

The same route can serve different formats:

```typescript
router.get("/users/:id", (ctx) => {
  const user = { id: ctx.params.id, name: `User ${ctx.params.id}` };

  if (ctx.accepts("application/json") && !ctx.accepts("text/html")) {
    return json(ctx, { user });
  }

  return html(ctx, `<h1>${user.name}</h1>`);
});
```

The logic: if the client **only** wants JSON (not HTML), send JSON.
Otherwise, default to HTML (what browsers want).

### Why Check Both?

Browsers send `Accept: text/html, */*` -- the `*/*` matches everything,
including `application/json`. So checking `accepts("application/json")`
alone would always be true for browsers. We check that the client wants
JSON **and** doesn't want HTML to correctly detect API-only clients.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Phoenix) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Check format | `accepts(conn, ["html", "json"])` | `ctx.accepts("application/json")` | `ctx.accepts("application/json")` |
| Read header | `get_req_header(conn, "accept")` | `headers.get("accept")` | `headers["accept"]` |
| Negotiate | Separate templates per format | `if/else` in handler | `if/else` in handler |
| Default | First format in list | HTML (browser-friendly) | HTML (browser-friendly) |

## The Code

### `src/blaze/context.ts` -- Added `accepts()`

```typescript
// -- Content negotiation --

accepts(type: string): boolean {
  const accept = (this.headers["accept"] as string) ?? "*/*";
  return accept.includes(type) || accept.includes("*/*");
}
```

Simple substring check on the `Accept` header. Returns `true` if the
client accepts the given media type, or if the client accepts anything
(`*/*`).

Note the Node.js difference: `this.headers["accept"]` returns
`string | string[] | undefined` from `IncomingMessage.headers`, so we
cast it to `string` and default to `"*/*"`.

### `src/app.ts` -- Content-Negotiating Route

```typescript
router.get("/users/:id", (ctx) => {
  const user = { id: ctx.params.id, name: `User ${ctx.params.id}` };

  if (ctx.accepts("application/json") && !ctx.accepts("text/html")) {
    return json(ctx, { user });
  }

  return html(
    ctx,
    `<h1>${user.name}</h1><p>ID: ${user.id}</p><p><a href="/">← Home</a></p>`,
  );
});
```

## How It Works

### Browser Request

```
GET /users/42
Accept: text/html, application/xhtml+xml, */*

ctx.accepts("application/json") → true (because */* matches)
ctx.accepts("text/html")        → true

JSON && !HTML → false → return HTML
```

### API Client Request

```
GET /users/42
Accept: application/json

ctx.accepts("application/json") → true
ctx.accepts("text/html")        → false

JSON && !HTML → true → return JSON
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Browser (gets HTML)

Visit http://localhost:4001/users/42 -- you'll see an HTML page with
"User 42" as a heading.

### 3. curl with JSON Accept (gets JSON)

```bash
curl -H "Accept: application/json" http://localhost:4001/users/42
# {"user":{"id":"42","name":"User 42"}}
```

### 4. curl without Accept header (gets HTML)

```bash
curl http://localhost:4001/users/42
# <h1>User 42</h1><p>ID: 42</p>...
```

Without an `Accept` header, `accepts()` defaults to `*/*`, which matches
both HTML and JSON -- so the HTML branch wins.

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/context.ts` | **Modified** | Added `accepts()` for content negotiation |
| `src/app.ts` | **Modified** | `/users/:id` now returns HTML or JSON based on Accept |

---

[← Previous: Step 9 - Full HTTP Methods](09-full-http-methods.md) | [Next: Step 11 - Scoped Routes →](11-scoped-routes.md)

## What's Next

Our routes are all defined at the top level. In **Step 11**, we'll add
**Scoped Routes** -- `scope("/api", () => { ... })` for grouping routes
under a shared prefix, like Phoenix's `scope` macro.
