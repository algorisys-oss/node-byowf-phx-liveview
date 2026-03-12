# Step 2: Context Object

[← Previous: Step 1 - HTTP Server](01-http-server.md) | [Next: Step 3 - Router →](03-router.md)

---

## What We're Building

In Step 1, our handler received raw `IncomingMessage` and `ServerResponse`
objects. That works, but it doesn't give us a place to accumulate state
as a request flows through multiple processing steps.

In this step, we create the `Context` class -- a single object that wraps
the incoming request and accumulates the outgoing response. Every handler,
middleware, and template will receive a `Context` and return a `Context`.

This is the foundational pattern that every web framework uses:

- **Phoenix/Plug:** `%Plug.Conn{}` struct
- **Koa:** `ctx` object
- **Hono:** `c` context
- **Express:** `req` + `res` (split across two objects -- messy)

### How This Compares to Ignite (Elixir) and Blaze (Bun)

In the Elixir version, Step 2 created the `%Ignite.Conn{}` struct with
fields for method, path, headers, status, response body, and a `halted`
flag. The parser filled the request fields, and controllers filled the
response fields using struct updates (`%{conn | status: 200}`).

In the Bun version, `Context` wraps the Web Standard `Request` object and
calls `new Response(...)` via `toResponse()`.

In Node.js, we wrap `IncomingMessage` (the request) and `ServerResponse`
(the response). Unlike Bun, Node.js responses are imperative -- you call
`res.writeHead()` and `res.end()`. Our `Context.send()` method abstracts
this behind a clean interface.

## Concepts You'll Learn

### The Pipeline Pattern

The core idea: create a context at the start of a request, pass it through
a series of functions (middleware, router, controller), and convert it to
a response at the end.

```
IncomingMessage → Context → [middleware] → [router] → [controller] → send()
```

Each step in the pipeline can read request data from the context and set
response data on it. This is how Phoenix processes every request through
its plug pipeline.

### Wrapping Request vs Duplicating It

We could copy every field from `IncomingMessage` into our own properties.
Instead, we keep a reference to the original `req` and extract the fields
we use most often (`method`, `path`, `url`, `headers`) as direct properties.

This gives us the best of both worlds:
- Quick access to common fields: `ctx.method`, `ctx.path`
- Full access to the original request: `ctx.req` (for body parsing, etc.)
- Full access to the response writer: `ctx.res` (if ever needed directly)

### Chainable Methods (Fluent API)

Each setter method returns `this`, enabling chaining:

```typescript
ctx.setStatus(200).setHeader("content-type", "text/html").setBody("<h1>Hi</h1>");
```

This is the TypeScript equivalent of Elixir's pipe operator:

```elixir
conn
|> put_status(200)
|> put_resp_header("content-type", "text/html")
|> send_resp("<h1>Hi</h1>")
```

### The `halted` Flag

When middleware needs to short-circuit the pipeline (e.g., authentication
fails), it sets `ctx.halt()`. Downstream middleware and the router check
`ctx.halted` and skip processing. We'll use this in Step 7 (Middleware).

### Private State

The `putPrivate()`/`getPrivate()` methods store framework-internal data
(CSRF tokens, flash messages, session data) separate from user-facing
fields. This prevents naming collisions between framework internals and
application code.

### send() vs toResponse()

The Bun version uses `toResponse()` which returns a Web `Response` object
(because `Bun.serve()` expects a `return new Response(...)`).

In Node.js, there's no return value -- you call methods on `res` to write
the response. Our `ctx.send()` method calls `res.writeHead()` and
`res.end()` internally, hiding this imperative detail.

### Node.js URL Parsing

`req.url` in Node.js is just the path + query string (e.g., `/hello?name=world`),
not a full URL. We must provide a base URL to construct a `URL` object:

```typescript
// req.url = "/hello?name=world"
const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
url.pathname           // "/hello"
url.searchParams.get("name")  // "world"
```

We use `req.headers.host` as the base so the URL reflects the actual host
header sent by the browser.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite Conn) | Bun (Blaze Context) | Node.js (Blaze Context) |
|---|---|---|---|
| Data structure | `%Ignite.Conn{}` struct | `Context` class | `Context` class |
| Request source | Raw TCP bytes | Web `Request` | `IncomingMessage` |
| Response target | Raw TCP send | Web `Response` | `ServerResponse` |
| Set status | `%{conn \| status: 200}` | `ctx.setStatus(200)` | `ctx.setStatus(200)` |
| Set header | `put_resp_header(conn, k, v)` | `ctx.setHeader(k, v)` | `ctx.setHeader(k, v)` |
| Set body | `%{conn \| resp_body: "..."}` | `ctx.setBody("...")` | `ctx.setBody("...")` |
| Halt pipeline | `%{conn \| halted: true}` | `ctx.halt()` | `ctx.halt()` |
| Build response | `send_resp(conn)` | `ctx.toResponse()` | `ctx.send()` |
| Immutability | Struct updates (new copy) | Mutable + chainable | Mutable + chainable |

**Note on mutability:** Elixir structs are immutable -- every update creates
a new struct. In TypeScript, we use mutable state with method chaining.
The pipeline *pattern* is the same (data flows through a series of
transforms), even though the *mechanism* differs.

## The Code

### `src/blaze/context.ts` -- The Pipeline Object

```typescript
/**
 * Blaze Context -- The request/response pipeline object.
 *
 * Equivalent to %Plug.Conn{} in Elixir / %Ignite.Conn{} in Ignite.
 * Wraps Node.js IncomingMessage and accumulates response state
 * as it flows through the middleware pipeline.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export class Context {
  // -- Request fields (set once at creation) --
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;

  // -- Params (filled by router in later steps) --
  params: Record<string, string> = {};

  // -- Response fields (accumulated through pipeline) --
  status: number = 200;
  private _respHeaders: Record<string, string> = {};
  private _respBody: string = "";

  // -- Pipeline control --
  halted: boolean = false;

  // -- Framework-internal state (flash, csrf, etc.) --
  private _private: Record<string, unknown> = {};

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? "GET";
    this.url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    this.path = this.url.pathname;
    this.headers = req.headers;
  }

  // -- Response accumulation --

  setStatus(code: number): this {
    this.status = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this._respHeaders[name.toLowerCase()] = value;
    return this;
  }

  setBody(body: string): this {
    this._respBody = body;
    return this;
  }

  halt(): this {
    this.halted = true;
    return this;
  }

  // -- Private state (for framework internals) --

  putPrivate(key: string, value: unknown): this {
    this._private[key] = value;
    return this;
  }

  getPrivate(key: string): unknown {
    return this._private[key];
  }

  // -- Send the response --

  send(): void {
    this.res.writeHead(this.status, this._respHeaders);
    this.res.end(this._respBody);
  }
}
```

**Key decisions:**

- **`readonly` request fields:** Method, path, URL, and headers are set once
  in the constructor and never changed. This prevents accidental mutation
  of request data.
- **Both `req` and `res` stored:** Unlike Bun where `toResponse()` creates
  a new `Response`, Node.js needs the original `ServerResponse` object to
  actually send data. We store both.
- **`params` is public and mutable:** The router (Step 5) will fill this
  with dynamic route parameters like `{ id: "42" }`.
- **Private response fields with setters:** `_respHeaders` and `_respBody`
  are accessed via `setHeader()` and `setBody()`. This ensures headers are
  always lowercased and gives us a place to add validation later.
- **`send()` is the exit point:** The context accumulates state throughout
  the pipeline, and `send()` writes it to the `ServerResponse` at the
  very end.
- **Return type `this`:** Methods return `this` (not `Context`) so
  subclasses would preserve their type through the chain.

### `src/blaze/server.ts` -- Updated to Use Context

```typescript
import { createServer, type Server } from "node:http";
import { Context } from "./context.js";

export interface ServeOptions {
  port?: number;
}

export function serve(options: ServeOptions = {}): Server {
  const port = options.port ?? 4001;

  const server = createServer((req, res) => {
    const ctx = new Context(req, res);

    console.log(`${ctx.method} ${ctx.path}`);

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

**What changed from Step 1:**

1. Import `Context` from the new module
2. Create a `Context` from `req` and `res`
3. Use `ctx.method` and `ctx.path` instead of parsing the URL manually
4. Build the response through the context's fluent API
5. Call `ctx.send()` instead of `res.writeHead()` + `res.end()` directly

The external behavior is identical -- same "Hello, Blaze!" response. But
now we have a data structure that can flow through a pipeline.

## How It Works

```
Browser                          Blaze Server
   |                                   |
   |--- HTTP GET /hello -------------->|
   |                                   |  1. new Context(req, res)
   |                                   |     ctx.method = "GET"
   |                                   |     ctx.path = "/hello"
   |                                   |
   |                                   |  2. ctx.setStatus(200)
   |                                   |       .setHeader("content-type", "text/plain")
   |                                   |       .setBody("Hello, Blaze!")
   |                                   |
   |                                   |  3. ctx.send()
   |<-- 200 OK "Hello, Blaze!" -------|     → res.writeHead(200, headers)
   |                                   |     → res.end("Hello, Blaze!")
```

The Context acts as a "bucket" that collects request information on the
way in and response information on the way out. Right now the pipeline is
trivial (one step), but in later steps we'll add middleware, routing, and
controllers that all operate on this same Context.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit http://localhost:4001

You should see the same "Hello, Blaze!" response as before. The Context
is invisible to the browser -- it's an internal framework concern.

### 3. Inspect the Context (optional)

Add a temporary log in `src/blaze/server.ts` to see what's inside:

```typescript
// In the createServer callback, after creating ctx:
console.log({
  method: ctx.method,
  path: ctx.path,
  host: ctx.headers.host,
  userAgent: ctx.headers["user-agent"],
});
```

### 4. Test with curl

```bash
curl -v http://localhost:4001/test
```

Check the terminal output -- you'll see the method and path logged from
the Context.

### 5. Type check

```bash
npx tsc --noEmit
```

Should complete with zero errors.

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/context.ts` | **New** | Context class -- request/response pipeline object |
| `src/blaze/server.ts` | **Modified** | Now creates Context and uses it for response |

---

[← Previous: Step 1 - HTTP Server](01-http-server.md) | [Next: Step 3 - Router →](03-router.md)

## What's Next

We have a Context that wraps requests and accumulates responses, but every
URL still gets the same response. In **Step 3**, we'll build a **Router**
that matches the request's method and path to different handler functions,
so `/` and `/about` can return different content.
