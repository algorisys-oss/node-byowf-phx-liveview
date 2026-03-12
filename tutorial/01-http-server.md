# Step 1: HTTP Server

[← Previous: Step 0 - Project Setup](00-project-setup.md) | [Next: Step 2 - Context Object →](02-context-object.md)

---

## What We're Building

Every web framework -- Phoenix, Rails, Express, Django -- is fundamentally
just a program that:

1. **Listens** on a network port (like port 4001)
2. **Receives** an HTTP request from a browser
3. **Sends** back an HTTP response

In this step, we build exactly that: an HTTP server that responds
"Hello, Blaze!" to every request.

### How This Compares to Ignite (Elixir) and Blaze (Bun)

In the Elixir version, Step 1 used raw `:gen_tcp` -- Erlang's TCP socket
module. We had to manually parse HTTP request bytes and construct HTTP
response strings. That taught us what HTTP really looks like on the wire.

In the Bun version, `Bun.serve()` handles everything with Web Standard
`Request`/`Response` objects.

In Node.js, `http.createServer()` gives us something in between: we don't
deal with raw TCP, but we work with Node.js-specific `IncomingMessage` and
`ServerResponse` objects (not Web Standards). This is what Express, Fastify,
and every Node.js framework builds on.

## Concepts You'll Learn

### http.createServer()

Node.js ships with `node:http` -- a built-in HTTP server. No external
packages needed. It handles:

- HTTP/1.1 parsing
- Keep-alive connections
- Chunked transfer encoding
- Request/response streaming

```typescript
import { createServer } from "node:http";

createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello!");
}).listen(4001);
```

The callback fires for every HTTP request. It receives:
- `req` -- an `IncomingMessage` (the request)
- `res` -- a `ServerResponse` (your response builder)

### IncomingMessage (the Request)

The `req` object contains everything about the incoming HTTP request:

```typescript
req.method    // "GET", "POST", etc.
req.url       // "/hello?name=world" (path + query, NOT full URL)
req.headers   // { host: "localhost:4001", ... }
```

**Important difference from Bun:** `req.url` is just the path + query string,
not a full URL. To parse it, we construct a full URL:

```typescript
const url = new URL(req.url ?? "/", `http://localhost:${port}`);
url.pathname           // "/hello"
url.searchParams.get("name")  // "world"
```

### ServerResponse (the Response)

The `res` object is how we send data back:

```typescript
res.writeHead(200, { "Content-Type": "text/plain" });  // status + headers
res.end("Hello, Blaze!");                                // body + finish
```

Key methods:
- **`res.writeHead(status, headers)`** -- set status code and headers
- **`res.write(chunk)`** -- send a chunk of the body (for streaming)
- **`res.end(body?)`** -- send final body chunk and finish the response

Unlike Bun's `return new Response(...)`, Node.js responses are
**mutable and imperative** -- you call methods on `res` to build it up.

### server.listen()

`createServer()` returns a `Server` object. We call `.listen(port)` to
start accepting connections:

```typescript
const server = createServer(handler);
server.listen(4001, () => {
  console.log("Server started");
});
```

The callback fires once the server is ready. The server runs until
you call `server.close()` or press `Ctrl+C`.

### Import with .js Extension

In ESM (`"type": "module"` in package.json), TypeScript requires `.js`
extensions in import paths -- even though the source files are `.ts`:

```typescript
import { serve } from "./blaze/server.js";  // ✓ correct
import { serve } from "./blaze/server.ts";  // ✗ won't work in Node.js ESM
import { serve } from "./blaze/server";     // ✗ won't work either
```

This is because TypeScript doesn't rewrite import paths. At runtime,
Node.js looks for `.js` files. tsx handles the mapping transparently.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Server | `:gen_tcp.listen/2` | `Bun.serve()` | `http.createServer()` |
| Read request | Manual HTTP parse | `fetch(req)` callback | `(req, res) => {}` callback |
| Request type | Binary pattern match | Web `Request` | `IncomingMessage` |
| Response type | Raw HTTP string | Web `Response` | `ServerResponse` |
| Send response | `:gen_tcp.send/2` | `return new Response(...)` | `res.writeHead()` + `res.end()` |
| Concurrency | BEAM process per conn | Event loop (single) | Event loop (single) |
| URL parsing | Manual | `new URL(req.url)` | `new URL(req.url, base)` |

## The Code

### `src/blaze/server.ts` -- The Framework

This is the framework's server module. In Phoenix terms, this is the
"Endpoint" layer.

```typescript
/**
 * Blaze Server -- The HTTP foundation.
 *
 * Equivalent to Ignite.Server in the Elixir version.
 * Wraps node:http to provide the framework's entry point.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export interface ServeOptions {
  port?: number;
}

export function serve(options: ServeOptions = {}): Server {
  const port = options.port ?? 4001;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    console.log(`${req.method} ${url.pathname}`);

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello, Blaze!");
  });

  server.listen(port, () => {
    console.log(`Blaze is heating up on http://localhost:${port}`);
  });

  return server;
}
```

**Key decisions:**

- `serve()` is a function, not a class. Keeps it simple.
- `ServeOptions` interface allows configuration (port for now, more later).
- We return the `server` object so tests can call `server.close()`.
- The callback logs every request -- basic visibility.
- `??` is the nullish coalescing operator: use `options.port` if provided,
  otherwise default to `4001`.
- `req.url` can be `undefined` in edge cases, so we default to `"/"`.
- The second argument to `new URL()` is the base URL -- required because
  `req.url` is just a path, not a full URL.

### `src/app.ts` -- The Application Entry Point

This is the "application" file -- the equivalent of Ignite's
`lib/ignite/application.ex`. It imports the framework and starts it:

```typescript
import { serve } from "./blaze/server.js";

serve({ port: 4001 });
```

Clean separation: the framework lives in `src/blaze/`, the application
that uses it lives in `src/`.

## How It Works

```
Browser                          Blaze Server (node:http)
   |                                   |
   |--- HTTP GET / ------------------>|  callback(req, res) is called
   |                                   |
   |<-- 200 OK "Hello, Blaze!" -------|  res.writeHead() + res.end()
   |                                   |
```

Like Bun, Node.js uses a single-threaded event loop. All requests are
handled on one thread. The event loop manages I/O efficiently -- while
one request waits for a database query, another can be processed.

For CPU-heavy work, we'll use `node:cluster` later (Step 42) to run
multiple Node.js instances across CPU cores.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

You should see: `Blaze is heating up on http://localhost:4001`

### 2. Open your browser

Visit http://localhost:4001

You should see: **Hello, Blaze!**

### 3. Try different URLs

- http://localhost:4001/anything
- http://localhost:4001/hello/world

They all return the same response. We'll fix that in Step 3 (Router).

### 4. Check the terminal

You'll see log lines for each request:

```
GET /
GET /favicon.ico
GET /anything
```

### 5. Try with curl

```bash
curl -v http://localhost:4001/
```

You'll see the full HTTP response including headers:

```
< HTTP/1.1 200 OK
< Content-Type: text/plain
<
Hello, Blaze!
```

### 6. Try the dev server (with hot reload)

```bash
npm run dev
```

This uses `tsx --watch` which automatically restarts when you edit files.
Edit the "Hello, Blaze!" text, save, and refresh your browser.

### 7. Stop the server

Press `Ctrl+C` in the terminal.

## File Checklist

After this step, your project should have these new/modified files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/server.ts` | **New** | Framework HTTP server using node:http |
| `src/app.ts` | **Modified** | Application entry point (imports and starts server) |

---

[← Previous: Step 0 - Project Setup](00-project-setup.md) | [Next: Step 2 - Context Object →](02-context-object.md)

## What's Next

Right now, every URL returns the same "Hello, Blaze!" response. We can't
tell the difference between `/` and `/about`.

In **Step 2**, we'll create a `Context` class -- a data structure that
holds all the information about a request (method, path, headers) and
its response (status, body). This is the same pattern Phoenix uses with
`%Plug.Conn{}`.
