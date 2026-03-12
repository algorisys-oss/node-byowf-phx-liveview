# Step 15: LiveView Base

[← Previous: Step 14 - uWebSockets.js Migration](14-uwebsockets-migration.md) | [Next: Step 16 - Frontend JS Glue →](16-frontend-js-glue.md)

---

## What We're Building

This is the **big one** -- server-rendered real-time views over WebSocket,
the core idea behind Phoenix LiveView.

A **LiveView** is a class instance that lives on the server, one per
WebSocket connection. It:

1. **Mounts** with initial state (assigns)
2. **Renders** HTML from those assigns
3. **Sends** the HTML to the browser over WebSocket
4. **Receives** user events (clicks, form submissions) over WebSocket
5. **Updates** assigns in `handleEvent()`
6. **Re-renders** and sends the new HTML

No page reloads. No REST API. No client-side state management. The server
owns the state, the client is just a thin rendering layer.

### How This Compares to Ignite (Elixir)

In the Elixir version, each LiveView connection is an Erlang process
managed by OTP. The process holds state in its mailbox, receives events
as messages, and re-renders on state changes.

In Blaze, each WebSocket connection gets a LiveView class instance stored
in the connection's `userData`. There's no process isolation (Node.js is
single-threaded), but the pattern is the same:

```
Elixir: GenServer process per connection
Bun:    Class instance in ws.data
Node:   Class instance in ws.getUserData()
```

## Concepts You'll Learn

### LiveView Lifecycle

```
Browser                          Server
  |                                |
  |-- GET /counter ---------------> | Serve HTML shell page
  | <---- HTML + inline JS ------- |
  |                                |
  |-- WebSocket connect ----------> | upgrade to WS
  |                                | new CounterLive()
  |                                | mount(socket) -> { count: 0 }
  |                                | render({ count: 0 })
  | <---- { type: "render", html } |
  |                                |
  |  [user clicks +]               |
  |-- { type: "event",            |
  |    event: "increment" } -----> | handleEvent("increment")
  |                                |   count: 0 -> 1
  |                                | render({ count: 1 })
  | <---- { type: "render", html } |
  |                                |
  |  [DOM updates instantly]       |
```

### LiveViewSocket

The `LiveViewSocket` is the interface a LiveView uses to manage state:

```typescript
interface LiveViewSocket {
  assigns: Record<string, unknown>;    // Current state
  assign(newAssigns: Record<string, unknown>): void;  // Merge new state
}
```

`assign()` merges new values into assigns (like `Map.merge` in Elixir).
It doesn't trigger a re-render on its own -- the handler re-renders after
`handleEvent()` returns.

### LiveView Abstract Class

```typescript
abstract class LiveView {
  abstract mount(socket: LiveViewSocket): void | Promise<void>;
  abstract handleEvent(event: string, params: Record<string, unknown>,
                       socket: LiveViewSocket): void | Promise<void>;
  abstract render(assigns: Record<string, unknown>): string;
}
```

### WebSocket Protocol

Messages are JSON objects with a `type` field:

**Client -> Server:**
```json
{ "type": "event", "event": "increment", "params": {} }
```

**Server -> Client:**
```json
{ "type": "render", "html": "<h1>Count: 1</h1>" }
```

### uWS WebSocket Upgrade

uWebSockets.js handles WebSocket upgrade differently from the browser
`WebSocket` API. The upgrade happens in a custom `upgrade` handler:

```typescript
app.ws<LiveConnection>("/live/websocket", {
  upgrade: (res, req, context) => {
    // Read headers synchronously (same constraint as HTTP)
    const secWebSocketKey = req.getHeader("sec-websocket-key");
    // ...
    res.upgrade(userData, secWebSocketKey, ...headers, context);
  },
  open: (ws) => { /* mount LiveView */ },
  message: (ws, message) => { /* handle events */ },
  close: (ws) => { /* cleanup */ },
});
```

The `upgrade()` call is where you attach per-connection data (`userData`)
that's accessible via `ws.getUserData()` throughout the connection.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Connection model | Erlang process | Class in `ws.data` | Class in `ws.getUserData()` |
| State storage | Process state | `socket.assigns` | `socket.assigns` |
| State update | `assign(socket, ...)` | `socket.assign({...})` | `socket.assign({...})` |
| WS upgrade | Cowboy upgrade | `server.upgrade(req)` | `res.upgrade(userData)` |
| WS handler | `handle_in/3` | `message(ws, msg)` | `message(ws, msg)` |
| Event prefix | `phx-click` | `bv-click` | `bv-click` |
| Protocol | Phoenix channels | JSON `{type, event}` | JSON `{type, event}` |

## The Code

### `src/blaze/live_view.ts` -- LiveView Class

This is the full file. It defines the abstract base class and socket interface.

```typescript
/**
 * Blaze LiveView -- Server-rendered real-time views over WebSocket.
 *
 * Equivalent to Phoenix.LiveView in the Elixir version.
 *
 * A LiveView is a class instance per WebSocket connection. The server:
 * 1. Calls mount() to set initial state (assigns)
 * 2. Calls render() to produce HTML from assigns
 * 3. Sends HTML to the client over WebSocket
 * 4. Receives events from the client (clicks, form submissions)
 * 5. Calls handleEvent() to update assigns
 * 6. Re-renders and sends updated HTML
 *
 * No page reloads -- all updates happen over a persistent WebSocket connection.
 */

/**
 * LiveViewSocket -- The interface a LiveView uses to manage state.
 *
 * Equivalent to Phoenix.LiveView.Socket. Holds the current assigns
 * and provides assign() to update them.
 */
export interface LiveViewSocket {
  /** Current state (key-value pairs) */
  assigns: Record<string, unknown>;

  /** Merge new values into assigns */
  assign(newAssigns: Record<string, unknown>): void;
}

/**
 * LiveView -- Abstract base class for real-time views.
 *
 * Subclass this and implement mount(), handleEvent(), and render().
 * Each WebSocket connection gets its own LiveView instance.
 */
export abstract class LiveView {
  /**
   * Called once when the WebSocket connects.
   * Set initial assigns here.
   */
  abstract mount(socket: LiveViewSocket): void | Promise<void>;

  /**
   * Called when the client sends an event (e.g., button click).
   * Update assigns based on the event and params.
   */
  abstract handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void | Promise<void>;

  /**
   * Return HTML string based on current assigns.
   * Called after mount() and after each handleEvent().
   */
  abstract render(assigns: Record<string, unknown>): string;
}
```

**Key decisions:**

- **Abstract class, not interface:** Forces subclasses to implement all
  three methods. Allows adding default implementations later (e.g.,
  `handleInfo()` for PubSub).
- **`socket.assign()` merges:** Like Elixir's `assign/2`, it merges new
  values into existing assigns rather than replacing them.
- **`render()` returns string:** For now, it's plain HTML. In later steps,
  we'll switch to a `Rendered` type for efficient diffing.

### `src/blaze/live_handler.ts` -- WebSocket Connection Manager

This is the full file. It manages the lifecycle of WebSocket connections:
creating LiveView instances, calling mount/handleEvent/render, and sending
responses.

```typescript
/**
 * Blaze LiveHandler -- Manages WebSocket connections for LiveViews.
 *
 * Each WebSocket connection is associated with a LiveView instance.
 * The handler orchestrates the lifecycle:
 *   open -> mount() -> render() -> send HTML
 *   message -> handleEvent() -> render() -> send HTML
 *   close -> cleanup
 *
 * Messages use a simple JSON protocol:
 *   Client -> Server: { type: "event", event: "increment", params: {} }
 *   Server -> Client: { type: "render", html: "<h1>Count: 1</h1>" }
 */

import type { WebSocket } from "uWebSockets.js";
import { LiveView, type LiveViewSocket } from "./live_view.js";

/** Per-connection data stored in ws.getUserData() */
export interface LiveConnection {
  path: string;
  view?: LiveView;
  socket?: LiveViewSocket;
}

/** LiveView class constructor type */
export type LiveViewClass = new () => LiveView;

/**
 * Create a LiveViewSocket for a connection.
 * The socket holds assigns and provides assign() to update them.
 */
function createSocket(): LiveViewSocket {
  const socket: LiveViewSocket = {
    assigns: {},
    assign(newAssigns: Record<string, unknown>) {
      Object.assign(socket.assigns, newAssigns);
    },
  };
  return socket;
}

/**
 * Handle WebSocket open: instantiate LiveView, mount, render, send.
 */
export async function handleOpen(
  ws: WebSocket<LiveConnection>,
  liveRoutes: Map<string, LiveViewClass>,
): Promise<void> {
  const data = ws.getUserData();
  const ViewClass = liveRoutes.get(data.path);

  if (!ViewClass) {
    ws.send(JSON.stringify({ type: "error", message: `No LiveView for path: ${data.path}` }));
    ws.close();
    return;
  }

  const view = new ViewClass();
  const socket = createSocket();
  data.view = view;
  data.socket = socket;

  await view.mount(socket);

  const html = view.render(socket.assigns);
  ws.send(JSON.stringify({ type: "render", html }));
}

/**
 * Handle WebSocket message: parse event, call handleEvent, re-render, send.
 */
export async function handleMessage(
  ws: WebSocket<LiveConnection>,
  message: ArrayBuffer,
): Promise<void> {
  const data = ws.getUserData();
  if (!data.view || !data.socket) return;

  let parsed: { type: string; event?: string; params?: Record<string, unknown> };
  try {
    parsed = JSON.parse(Buffer.from(message).toString("utf-8"));
  } catch {
    return; // Ignore malformed messages
  }

  if (parsed.type === "event" && parsed.event) {
    await data.view.handleEvent(parsed.event, parsed.params ?? {}, data.socket);

    const html = data.view.render(data.socket.assigns);
    ws.send(JSON.stringify({ type: "render", html }));
  }
}

/**
 * Handle WebSocket close: cleanup.
 */
export function handleClose(ws: WebSocket<LiveConnection>): void {
  const data = ws.getUserData();
  data.view = undefined;
  data.socket = undefined;
}
```

**Key decisions:**

- **One LiveView per connection:** Each WebSocket gets its own class
  instance, just like each Elixir process has its own state.
- **`createSocket()` factory:** Creates the `LiveViewSocket` with a
  closure over `assigns`, keeping the interface clean. The `assign()`
  method uses `Object.assign()` to merge new values into the existing
  assigns object.
- **`LiveViewClass` type:** A constructor type (`new () => LiveView`)
  that allows the handler to instantiate LiveView subclasses dynamically.
- **Re-render after every event:** After `handleEvent()`, we always
  re-render and send the full HTML. Diffing comes in Step 17.
- **Error handling for unknown routes:** If no LiveView class is registered
  for the requested path, we send an error message and close the connection.

### `src/blaze/server.ts` -- WebSocket Support Added

This is the full file. It now handles both HTTP and WebSocket connections.
The key additions from step 14 are: `liveRoutes` option, `app.ws()` handler,
`liveViewPage()` function, and the live route check in the HTTP handler.

```typescript
/**
 * Blaze Server -- HTTP + WebSocket, powered by uWebSockets.js.
 *
 * Equivalent to Ignite.Server in the Elixir version.
 * Provides both HTTP routing and WebSocket-based LiveView connections
 * on the same port.
 *
 * Key uWS constraints handled here:
 * - HttpRequest is stack-allocated: all request data must be read synchronously
 * - HttpResponse requires onAborted() if not responding immediately
 * - Body reading uses res.onData() callback
 * - Response batching via res.cork() for optimal performance
 * - WebSocket upgrade via app.ws() with custom userData
 */

import uWS from "uWebSockets.js";
import { Context } from "./context.js";
import type { Router } from "./router.js";
import type { LiveViewClass, LiveConnection } from "./live_handler.js";
import { handleOpen, handleMessage, handleClose } from "./live_handler.js";

export interface ServeOptions {
  port?: number;
  router?: Router;
  dev?: boolean;
  liveRoutes?: Map<string, LiveViewClass>;
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

/**
 * Generate the HTML shell page for a LiveView route.
 * Contains a container div and inline JS that connects via WebSocket.
 */
function liveViewPage(path: string, port: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Blaze LiveView</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    button { font-size: 1.2rem; padding: 0.5rem 1.5rem; margin: 0.25rem; cursor: pointer; }
    .status { color: #999; font-size: 0.85em; margin-top: 1rem; }
    .status.connected { color: #2a2; }
    .status.disconnected { color: #c33; }
  </style>
</head>
<body>
  <div id="blaze-container">Connecting...</div>
  <p class="status" id="blaze-status">Connecting...</p>
  <p><a href="/">← Back to home</a></p>

  <script>
    (function() {
      const container = document.getElementById("blaze-container");
      const statusEl = document.getElementById("blaze-status");
      const path = ${JSON.stringify(path)};

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(proto + "//" + location.host + "/live/websocket?path=" + encodeURIComponent(path));

      ws.onopen = () => {
        statusEl.textContent = "Connected";
        statusEl.className = "status connected";
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "render") {
          container.innerHTML = msg.html;
          // Attach bv-click event listeners to new elements
          container.querySelectorAll("[bv-click]").forEach((el) => {
            el.addEventListener("click", () => {
              const event = el.getAttribute("bv-click");
              ws.send(JSON.stringify({ type: "event", event, params: {} }));
            });
          });
        }
      };

      ws.onclose = () => {
        statusEl.textContent = "Disconnected";
        statusEl.className = "status disconnected";
      };
    })();
  </script>
</body>
</html>`;
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4001;
  const router = options.router;
  const dev = options.dev ?? true;
  const liveRoutes = options.liveRoutes ?? new Map();

  const app = uWS.App();

  // ── WebSocket handler for LiveView connections ──
  app.ws<LiveConnection>("/live/websocket", {
    upgrade: (res, req, context) => {
      const query = req.getQuery() ?? "";
      const params = new URLSearchParams(query);
      const path = params.get("path") ?? "/";

      // Must read all headers synchronously before upgrade
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");

      res.upgrade<LiveConnection>(
        { path },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context,
      );
    },

    open: (ws) => {
      handleOpen(ws, liveRoutes);
    },

    message: (ws, message) => {
      handleMessage(ws, message);
    },

    close: (ws) => {
      handleClose(ws);
    },
  });

  // ── HTTP handler ──
  app.any("/*", (res, req) => {
    // 1. Extract all request data SYNCHRONOUSLY
    const method = req.getCaseSensitiveMethod();
    const path = req.getUrl();
    const query = req.getQuery() ?? "";

    const headers: Record<string, string> = {};
    req.forEach((key, value) => {
      headers[key] = value;
    });

    // 2. Check if this is a LiveView route (GET only)
    if (method === "GET" && liveRoutes.has(path)) {
      res.cork(() => {
        res.writeStatus("200");
        res.writeHeader("content-type", "text/html; charset=utf-8");
        res.end(liveViewPage(path, port));
      });
      return;
    }

    // 3. Track abort state
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });

    // 4. Helper to send a response safely
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

    // 5. Handle the request (with body reading if needed)
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

    // 6. Read body or dispatch immediately
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      let buffer = Buffer.alloc(0);
      res.onData((chunk, isLast) => {
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

**Key decisions:**

- **`liveRoutes` option:** A `Map<string, LiveViewClass>` mapping URL paths
  to LiveView class constructors. This is passed in from `app.ts`.
- **`app.ws()` before `app.any()`:** uWS matches routes in registration
  order. WebSocket upgrades to `/live/websocket` are handled before the
  catch-all HTTP handler.
- **WebSocket upgrade with `userData`:** The `upgrade` handler reads the
  `path` query parameter and passes it as `{ path }` in `userData`. This
  is available later via `ws.getUserData()`.
- **Live routes served as HTML shells:** When the browser navigates to
  `/counter`, the HTTP handler detects it's a live route and returns an
  HTML page with inline JS that opens a WebSocket.
- **WebSocket path convention:** All LiveView WebSocket connections go to
  `/live/websocket?path=/counter`. The `path` query parameter tells the
  server which LiveView class to instantiate.
- **Inline JS (temporary):** The `liveViewPage()` function embeds minimal
  JavaScript that connects via WebSocket and handles `bv-click` events
  by querying the DOM after each render. This is a stepping stone --
  Step 16 extracts this into a proper `blaze.js` client.

### `src/my_app/counter_live.ts` -- Counter Demo

This is the full file. A simple LiveView that demonstrates the lifecycle.

```typescript
/**
 * Counter LiveView -- A real-time counter that updates over WebSocket.
 *
 * Demonstrates the LiveView lifecycle:
 * 1. mount() sets initial count to 0
 * 2. handleEvent() responds to increment/decrement/reset
 * 3. render() returns HTML with current count
 *
 * No page reloads -- all updates happen over WebSocket.
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";

export class CounterLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({ count: 0 });
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const count = socket.assigns.count as number;

    switch (event) {
      case "increment":
        socket.assign({ count: count + 1 });
        break;
      case "decrement":
        socket.assign({ count: count - 1 });
        break;
      case "reset":
        socket.assign({ count: 0 });
        break;
    }
  }

  render(assigns: Record<string, unknown>): string {
    return `
      <h1>Live Counter</h1>
      <p style="font-size: 3rem; font-weight: bold; margin: 1rem 0;">${assigns.count}</p>
      <div>
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <p style="color: #888; margin-top: 1rem; font-size: 0.9rem;">
        Click the buttons — updates happen over WebSocket, no page reload.
      </p>
    `;
  }
}
```

### `src/app.ts` -- Registration

Add the LiveView import and route registration to your existing `app.ts`.
The key additions are the import of `CounterLive`, the `LiveViewClass` type,
the `liveRoutes` map, and passing it to `serve()`. Also add a link to the
counter on the landing page.

```typescript
import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";
import { text, html, json, redirect, render } from "./blaze/controller.js";
import { CounterLive } from "./my_app/counter_live.js";
import type { LiveViewClass } from "./blaze/live_handler.js";

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

// Parse request body for POST/PUT/PATCH
router.use((ctx) => {
  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    return ctx.parseBody();
  }
  return ctx;
});

// -- Routes --

router.get("/", (ctx) =>
  html(
    ctx,
    `<h1>Welcome to Blaze!</h1>
<p>A Phoenix-like framework for Node.js</p>
<h2>Routes to try:</h2>
<ul>
  <li><a href="/hello">/hello</a> — plain text</li>
  <li><a href="/api/status">/api/status</a> — scoped JSON API</li>
  <li><a href="/api/users/42">/api/users/42</a> — scoped API route</li>
  <li><a href="/users/42">/users/42</a> — content negotiation (HTML/JSON)</li>
  <li><a href="/posts/7/comments/3">/posts/7/comments/3</a> — multi-param route</li>
  <li><a href="/greet/world">/greet/world</a> — greeting with param</li>
  <li><a href="/profile/42">/profile/42</a> — template-rendered profile</li>
  <li><a href="/old-page">/old-page</a> — redirect to /</li>
  <li><a href="/echo">/echo</a> — POST body parser (form + JSON)</li>
  <li><a href="/routes">/routes</a> — route listing + path helpers</li>
  <li><a href="/crash">/crash</a> — error handler (500 page)</li>
  <li><a href="/nope">/nope</a> — 404 page</li>
</ul>
<h2>LiveView</h2>
<ul>
  <li><a href="/counter">/counter</a> — real-time counter (WebSocket LiveView)</li>
</ul>`,
  ),
);

// ... (all other routes from previous steps remain unchanged) ...

// -- LiveView routes --

const liveRoutes = new Map<string, LiveViewClass>([
  ["/counter", CounterLive],
]);

serve({ port: 4001, router, liveRoutes });
```

## How It Works

### Two-Phase Connection

```
Phase 1: HTTP (page load)
  GET /counter
  -> Server detects live route
  -> Returns HTML shell with inline JS
  -> Browser renders page with "Connecting..." placeholder

Phase 2: WebSocket (real-time)
  Browser JS opens WS to /live/websocket?path=/counter
  -> Server upgrades connection
  -> Creates CounterLive instance
  -> Calls mount() -> assigns = { count: 0 }
  -> Calls render() -> HTML with count=0
  -> Sends { type: "render", html: "..." }
  -> Browser replaces container innerHTML
  -> Attaches bv-click listeners
  -> User clicks [+]
  -> Browser sends { type: "event", event: "increment" }
  -> Server calls handleEvent() -> count becomes 1
  -> Server calls render() -> HTML with count=1
  -> Sends updated HTML
  -> Browser updates DOM
```

### Inline Client JS (Preview)

The HTML shell includes minimal inline JavaScript that:

1. Opens a WebSocket to `/live/websocket?path=/counter`
2. On `render` messages, replaces `#blaze-container` innerHTML
3. After each render, finds `[bv-click]` elements and attaches click
   listeners that send `event` messages back to the server

This inline JS is a stepping stone -- in **Step 16**, we'll extract it
into a proper `blaze.js` client with full event delegation.

### WebSocket Upgrade Flow

The uWS `app.ws()` handler processes WebSocket connections in stages:

1. **`upgrade`**: Runs synchronously when the browser requests a WebSocket
   upgrade. We read the `path` query parameter and WebSocket headers,
   then call `res.upgrade()` with a `LiveConnection` object as `userData`.

2. **`open`**: Called after the upgrade completes. We look up the
   `LiveViewClass` from `liveRoutes`, create an instance, call `mount()`,
   then `render()`, and send the initial HTML.

3. **`message`**: Called when the client sends a JSON message. We parse it,
   call `handleEvent()`, re-render, and send the updated HTML.

4. **`close`**: Called when the WebSocket disconnects. We clean up by
   setting `view` and `socket` to `undefined`.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the counter

Open http://localhost:4001/counter in your browser. You should see:

- A "Live Counter" heading
- The number **0**
- Three buttons: **-**, **Reset**, **+**
- A "Connected" status indicator

### 3. Click the buttons

Click **+** several times -- the counter increments instantly. Click **-**
to decrement. Click **Reset** to go back to 0.

No page reloads. Open your browser's Network tab and watch the WebSocket
frames -- you'll see the JSON messages flowing back and forth.

### 4. Open multiple tabs

Open `/counter` in two browser tabs. Each has its own counter -- they're
independent connections with independent state. (Shared state via PubSub
comes in Step 21.)

### 5. Verify existing routes

```bash
curl http://localhost:4001/hello
# Hello, Blaze!

curl http://localhost:4001/api/status
# {"status":"ok","framework":"Blaze"}
```

All existing HTTP routes continue to work alongside LiveView.

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/live_view.ts` | **New** | `LiveView` abstract class, `LiveViewSocket` interface |
| `src/blaze/live_handler.ts` | **New** | WebSocket open/message/close handlers, `createSocket()`, `LiveConnection` type, `LiveViewClass` type |
| `src/blaze/server.ts` | **Modified** | `app.ws()` for WebSocket, `liveRoutes` option, `liveViewPage()` HTML shell |
| `src/my_app/counter_live.ts` | **New** | Counter LiveView demo |
| `src/app.ts` | **Modified** | Register counter live route, landing page link |

---

[← Previous: Step 14 - uWebSockets.js Migration](14-uwebsockets-migration.md) | [Next: Step 16 - Frontend JS Glue →](16-frontend-js-glue.md)

## What's Next

The counter works, but the inline client JS is minimal -- it only handles
`bv-click` and uses `innerHTML` for updates. In **Step 16**, we'll extract
it into a proper `public/blaze.js` client that:

- Uses **event delegation** (one listener on the container, not per-element)
- Handles `bv-click`, `bv-change`, and `bv-submit` events
- Manages reconnection on disconnect
- Prepares for morphdom-based DOM patching in Step 19
