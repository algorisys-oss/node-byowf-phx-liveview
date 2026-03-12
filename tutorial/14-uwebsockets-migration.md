# Step 14: uWebSockets.js Migration

[← Previous: Step 13 - Error Handler](13-error-handler.md) | [Next: Step 15 - LiveView Base →](15-liveview-base.md)

---

## What We're Building

We're replacing `node:http` with **uWebSockets.js** (uWS) -- the fastest
HTTP + WebSocket server for Node.js. This is the foundation for Module 2:
LiveView Core, where we'll need WebSocket support on the same server.

The migration is **transparent** to the rest of the framework. Router,
controller, template, and application code remain **completely unchanged**.
Only two files change:

1. **`context.ts`** -- Refactored from `(IncomingMessage, ServerResponse)`
   to a transport-agnostic `ContextInit` interface
2. **`server.ts`** -- Rewritten from `createServer()` to `uWS.App()`

### How This Compares to Ignite (Elixir)

In the Elixir version, the web server is Cowboy (or Bandit), sitting behind
an adapter layer. Switching from Cowboy to Bandit requires no changes to
the router or controllers -- the Plug interface abstracts the transport.

In Blaze for Bun, `Bun.serve()` provides HTTP + WebSocket natively -- no
migration needed. In Blaze for Node.js, we start with `node:http` for
learning, then migrate to uWebSockets.js for production-grade performance
and WebSocket support.

## Concepts You'll Learn

### Why uWebSockets.js?

| Feature | `node:http` | uWebSockets.js |
|---|---|---|
| HTTP performance | Baseline | 5-10x faster |
| WebSocket support | None (need `ws` package) | Built-in, native |
| HTTP + WS same port | Not possible | Yes |
| Backpressure handling | Manual | Built-in |
| Binary protocol | JavaScript objects | C++ with JS bindings |

### Installing uWebSockets.js

uWebSockets.js is installed directly from GitHub (not npm):

```bash
npm install uWebSockets.js@github:uNetworking/uWebSockets.js#v20.60.0
```

This adds the following to your `package.json`:

```json
{
  "dependencies": {
    "uWebSockets.js": "github:uNetworking/uWebSockets.js#v20.60.0"
  }
}
```

### Stack-Allocated HttpRequest

The most important constraint in uWebSockets.js: `HttpRequest` is
**stack-allocated in C++**. This means:

- You **MUST** read all request data (method, URL, headers) **synchronously**
  in the handler callback, before any `await` or return
- After the handler returns (or after any `await`), the `HttpRequest` object
  is **invalid** -- accessing it causes undefined behavior

```typescript
// CORRECT: Read everything synchronously first
app.any("/*", (res, req) => {
  const method = req.getCaseSensitiveMethod();  // sync, OK
  const path = req.getUrl();                     // sync, OK
  const headers: Record<string, string> = {};
  req.forEach((key, value) => { headers[key] = value; });  // sync, OK

  // Now safe to do async work -- req is no longer needed
  handleAsync(method, path, headers);
});

// WRONG: Accessing req after await
app.any("/*", async (res, req) => {
  const body = await readBody(res);
  const method = req.getMethod();  // CRASH -- req is invalid
});
```

### Transport-Agnostic Context

To decouple `Context` from any specific HTTP server, we introduce a
`ContextInit` interface:

```typescript
interface ContextInit {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  rawBody?: string;
  sendFn: (status: number, headers: Record<string, string>, body: string) => void;
}
```

The key insight is `sendFn` -- a closure that knows how to write the
response using whatever transport created it. The Context never touches
`res` directly.

### Body Reading with res.onData()

Unlike `node:http` streams (`req.on('data'/'end')`), uWS delivers body
data through `res.onData()`:

```typescript
res.onData((chunk, isLast) => {
  // MUST copy chunk -- uWS neuters the ArrayBuffer on return
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
  if (isLast) {
    // Full body received, process request
    handleRequest(buffer.toString("utf-8"));
  }
});
```

### Abort Tracking

If the client disconnects mid-request, uWS calls `res.onAborted()`. After
that, writing to `res` crashes the server. We track this with a boolean:

```typescript
let aborted = false;
res.onAborted(() => { aborted = true; });

// Later, before any write:
if (aborted) return;
```

### Response Corking

`res.cork()` batches multiple write operations into a single syscall:

```typescript
res.cork(() => {
  res.writeStatus("200");
  res.writeHeader("content-type", "text/html");
  res.end("<h1>Hello</h1>");
});
// All three calls execute as one efficient write
```

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| HTTP server | Cowboy/Bandit | `Bun.serve()` | uWebSockets.js `App()` |
| WS server | Cowboy WS | `Bun.serve({ websocket })` | uWS `app.ws()` |
| Adapter layer | Plug adapter | Native (Bun API) | `ContextInit` + `sendFn` |
| Request object | `%Plug.Conn{}` | `Request` (Web API) | Stack-allocated `HttpRequest` |
| Body reading | Plug parsers | `req.json()`, `req.formData()` | `res.onData()` callback |
| Response | `send_resp()` | `new Response()` | `res.cork()` + `res.end()` |

## The Code

### `src/blaze/context.ts` -- Transport-Agnostic Context

This is the full file. The key change from step 13 is removing the
`node:http` dependency (`IncomingMessage`, `ServerResponse`) and replacing
them with the `ContextInit` interface and `sendFn` closure.

```typescript
/**
 * Blaze Context -- The request/response pipeline object.
 *
 * Equivalent to %Plug.Conn{} in Elixir / %Ignite.Conn{} in Ignite.
 * Transport-agnostic: accepts a ContextInit with pre-extracted request
 * data and a sendFn closure for writing the response.
 *
 * This design allows the same Context to work with node:http, uWebSockets.js,
 * or any other HTTP server — the transport details live in sendFn.
 */

export interface ContextInit {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  rawBody?: string;
  sendFn: (status: number, headers: Record<string, string>, body: string) => void;
}

export class Context {
  // -- Request fields (set once at creation) --
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly url: URL;
  readonly headers: Record<string, string>;

  // -- Params (filled by router) --
  params: Record<string, string> = {};

  // -- Request body (filled by parseBody()) --
  body: Record<string, unknown> = {};

  // -- Response fields (accumulated through pipeline) --
  status: number = 200;
  private _respHeaders: Record<string, string> = {};
  private _respBody: string = "";

  // -- Pipeline control --
  halted: boolean = false;

  // -- Framework-internal state (flash, csrf, etc.) --
  private _private: Record<string, unknown> = {};

  // -- Transport --
  private _rawBody: string;
  private _sendFn: (status: number, headers: Record<string, string>, body: string) => void;

  constructor(init: ContextInit) {
    this.method = init.method;
    this.path = init.path;
    this.query = init.query;
    this.headers = init.headers;
    this._rawBody = init.rawBody ?? "";
    this._sendFn = init.sendFn;

    // Build URL for compatibility (used by some middleware)
    const host = init.headers["host"] ?? "localhost";
    const qs = init.query ? `?${init.query}` : "";
    this.url = new URL(`${init.path}${qs}`, `http://${host}`);
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

  // -- Content negotiation --

  accepts(type: string): boolean {
    const accept = this.headers["accept"] ?? "*/*";
    return accept.includes(type) || accept.includes("*/*");
  }

  // -- Body parsing --

  async parseBody(): Promise<this> {
    const contentType = this.headers["content-type"] ?? "";

    if (contentType.includes("application/json")) {
      try {
        this.body = JSON.parse(this._rawBody) as Record<string, unknown>;
      } catch {
        this.body = {};
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(this._rawBody);
      const parsed: Record<string, unknown> = {};
      for (const [key, value] of params) {
        parsed[key] = value;
      }
      this.body = parsed;
    }

    return this;
  }

  // -- Send the response --

  send(): void {
    this._sendFn(this.status, this._respHeaders, this._respBody);
  }
}
```

**Key changes from the `node:http` version (step 13):**

- **No `IncomingMessage` or `ServerResponse`:** Context is fully decoupled
  from the HTTP transport. No more `import type { IncomingMessage, ServerResponse } from "node:http"`.
- **`sendFn` closure:** The server provides a function that knows how to
  write the response. Context just calls it with status, headers, and body.
- **`rawBody` pre-read:** Body is read by the server before Context is
  created, so `parseBody()` just parses a string -- no streams.
- **`headers` is `Record<string, string>`:** Simplified from Node.js's
  `string | string[] | undefined` since uWS headers are always strings.
- **`query` field added:** Extracted separately since uWS provides it via
  `req.getQuery()` rather than as part of the URL.

### `src/blaze/server.ts` -- uWebSockets.js Server

This is the full file. It replaces the `node:http` `createServer()` with
`uWS.App()`.

```typescript
/**
 * Blaze Server -- The HTTP foundation, powered by uWebSockets.js.
 *
 * Equivalent to Ignite.Server in the Elixir version.
 * Replaces node:http with uWebSockets.js for high-performance HTTP + WebSocket support.
 *
 * Key uWS constraints handled here:
 * - HttpRequest is stack-allocated: all request data must be read synchronously
 *   before any async work (awaits, callbacks, etc.)
 * - HttpResponse requires onAborted() if not responding immediately
 * - Body reading uses res.onData() callback (not Node.js streams)
 * - Response batching via res.cork() for optimal performance
 */

import uWS from "uWebSockets.js";
import { Context } from "./context.js";
import type { Router } from "./router.js";

export interface ServeOptions {
  port?: number;
  router?: Router;
  dev?: boolean;
}

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function devErrorPage(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";

  return `<!DOCTYPE html>
<html>
<head><title>500 — ${htmlEscape(name)}</title>
<style>
  body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  h1 { color: #c33; }
  .message { background: #fff3f3; border: 1px solid #fcc; padding: 1rem; border-radius: 4px; }
  .stack { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.9em; }
  .hint { color: #999; font-size: 0.85em; }
</style>
</head>
<body>
  <h1>500 <span>${htmlEscape(name)}</span></h1>
  <div class="message">${htmlEscape(message)}</div>
  <h2>Stack Trace</h2>
  <pre class="stack">${htmlEscape(stack)}</pre>
  <p class="hint">This error page is shown in development mode. Set <code>dev: false</code> in production.</p>
</body>
</html>`;
}

function prodErrorPage(): string {
  return `<html><body><h1>500</h1><p>Internal Server Error</p></body></html>`;
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4001;
  const router = options.router;
  const dev = options.dev ?? true;

  const app = uWS.App();

  app.any("/*", (res, req) => {
    // ── 1. Extract all request data SYNCHRONOUSLY ──
    // HttpRequest is stack-allocated — accessing it after return or await is undefined behavior.
    const method = req.getCaseSensitiveMethod();
    const path = req.getUrl();
    const query = req.getQuery() ?? "";

    const headers: Record<string, string> = {};
    req.forEach((key, value) => {
      headers[key] = value;
    });

    // ── 2. Track abort state ──
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });

    // ── 3. Helper to send a response safely ──
    const sendResponse = (status: number, respHeaders: Record<string, string>, body: string) => {
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(String(status));
        for (const [k, v] of Object.entries(respHeaders)) {
          res.writeHeader(k, v);
        }
        res.end(body);
      });
    };

    // ── 4. Handle the request (with body reading if needed) ──
    const handleRequest = async (rawBody: string) => {
      if (aborted) return;

      const ctx = new Context({ method, path, query, headers, rawBody, sendFn: sendResponse });

      try {
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
      } catch (error) {
        console.error("Unhandled error:", error);
        if (aborted) return;
        const body = dev ? devErrorPage(error) : prodErrorPage();
        sendResponse(500, { "content-type": "text/html; charset=utf-8" }, body);
      }
    };

    // ── 5. Read body or dispatch immediately ──
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      let buffer = Buffer.alloc(0);
      res.onData((chunk, isLast) => {
        // Must copy — uWS neuters the ArrayBuffer after this callback returns
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (isLast) {
          handleRequest(buffer.toString("utf-8"));
        }
      });
    } else {
      handleRequest("");
    }
  });

  app.listen(port, (listenSocket) => {
    if (listenSocket) {
      console.log(`Blaze is heating up on http://localhost:${port}`);
    } else {
      console.error(`Failed to listen on port ${port}`);
    }
  });

  return app;
}
```

**Key design decisions:**

- **Synchronous outer handler:** The `app.any()` callback is synchronous
  (not `async`). This is correct -- the async work happens inside
  `handleRequest()`, called after body reading completes.
- **Single `onAborted`:** One abort handler tracks client disconnects. Both
  body reading and response sending check this flag.
- **`sendFn` closure:** Captures `res` and `aborted` from the handler
  scope, making Context transport-agnostic.
- **`res.cork()`:** All response writes (status, headers, body) are batched
  in a single cork call for optimal performance.
- **Body reading for POST/PUT/PATCH only:** GET and DELETE skip body
  reading entirely.

## How It Works

### Request Lifecycle (uWS)

```
Client sends request
  |
uWS calls handler(res, req)          <-- synchronous
  |-- Extract method, path, headers   <-- MUST be sync (req is stack-allocated)
  |-- Register res.onAborted()
  +-- If POST/PUT/PATCH:
  |    res.onData() collects body     <-- async callback
  |    +-- handleRequest(rawBody)
  +-- Else:
       handleRequest("")              <-- runs immediately

handleRequest(rawBody):               <-- async
  |-- Create Context with sendFn
  |-- Run middleware pipeline
  |-- Match route, call handler
  |-- ctx.send() -> sendFn()
  +-- sendFn -> res.cork() + res.end() <-- back to uWS
```

### What Changed vs What Didn't

```
CHANGED (2 files):
  src/blaze/context.ts  <-- ContextInit + sendFn (no more node:http types)
  src/blaze/server.ts   <-- uWS.App() replaces createServer()

UNCHANGED (everything else):
  src/blaze/router.ts     <-- same route matching, middleware pipeline
  src/blaze/controller.ts <-- same text(), html(), json(), redirect(), render()
  src/blaze/template.ts   <-- same file-based templates
  src/app.ts              <-- zero changes to application code
```

## Try It Out

### 1. Install uWebSockets.js

```bash
npm install uWebSockets.js@github:uNetworking/uWebSockets.js#v20.60.0
```

### 2. Start the server

```bash
npx tsx src/app.ts
```

### 3. Test all routes

```bash
# Landing page
curl http://localhost:4001/

# Plain text
curl http://localhost:4001/hello

# JSON API
curl http://localhost:4001/api/status

# Dynamic params
curl http://localhost:4001/api/users/42

# POST with form data
curl -X POST -d "name=Alice&email=alice@example.com" http://localhost:4001/echo

# POST with JSON
curl -X POST -H "Content-Type: application/json" -d '{"name":"Bob"}' http://localhost:4001/echo

# PUT / PATCH / DELETE
curl -X PUT -H "Content-Type: application/json" -d '{"updated":true}' http://localhost:4001/echo
curl -X PATCH -H "Content-Type: application/json" -d '{"patched":true}' http://localhost:4001/echo
curl -X DELETE http://localhost:4001/echo

# Template rendering
curl http://localhost:4001/profile/42

# Path helpers
curl http://localhost:4001/routes

# Error handler
curl http://localhost:4001/crash

# 404
curl http://localhost:4001/nope

# Redirect
curl -v http://localhost:4001/old-page 2>&1 | grep "< location"
```

Every route should work exactly as before -- the migration is transparent.

### 4. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/context.ts` | **Modified** | `ContextInit` interface, `sendFn` closure, transport-agnostic |
| `src/blaze/server.ts` | **Modified** | uWS `App()`, sync request extraction, `onData()` body reading, `cork()` responses |
| `package.json` | **Modified** | uWebSockets.js dependency added |

---

[← Previous: Step 13 - Error Handler](13-error-handler.md) | [Next: Step 15 - LiveView Base →](15-liveview-base.md)

## What's Next

With uWebSockets.js in place, we now have HTTP + WebSocket support on the
same server. In **Step 15**, we'll build the **LiveView Base** -- a
`LiveView` class with `mount()`, `handleEvent()`, and `render()` methods,
connected via WebSocket upgrade through uWS's `app.ws()` handler. This is
where real-time interactivity begins.
