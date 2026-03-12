# Step 16: Frontend JS Glue

[← Previous: Step 15 - LiveView Base](15-liveview-base.md) | [Next: Step 17 - Diffing Engine →](17-diffing-engine.md)

---

## What We're Building

In Step 15, we had inline JavaScript in the LiveView HTML shell --
hardcoded, minimal, and only supporting `bv-click` with per-element
listeners. In this step, we extract that into a proper **`blaze.js`**
client library that:

1. Uses **event delegation** (one listener on the container, not per-element)
2. Supports **`bv-click`**, **`bv-change`**, **`bv-submit`**, and **`bv-keydown`**
3. **Auto-reconnects** with exponential backoff on disconnect
4. Reads its configuration from **`data-path`** on the container element

We also add **static file serving** so the server can serve `blaze.js`
(and future CSS, images, etc.) from a `public/` directory.

### How This Compares to Ignite (Elixir)

In Phoenix, the equivalent is `phoenix.js` (the LiveView client library)
and `phoenix_html.js`. These handle channel connections, event binding,
morphdom integration, and more.

In Blaze, `blaze.js` starts simple and grows with each step. Right now
it handles WebSocket connection and event delegation. Later steps add
morphdom (Step 19), hooks (Step 24), and navigation (Step 22).

## Concepts You'll Learn

### Event Delegation

Instead of attaching listeners to each element after every render:

```javascript
// Step 15: Per-element binding (breaks on innerHTML replace)
container.querySelectorAll("[bv-click]").forEach((el) => {
  el.addEventListener("click", () => { ... });
});
```

We use event delegation -- a single listener on the container that
catches bubbling events:

```javascript
// Step 16: Event delegation (survives innerHTML replace)
container.addEventListener("click", function (e) {
  var target = e.target.closest("[bv-click]");
  if (target) {
    sendEvent(target.getAttribute("bv-click"));
  }
});
```

**Why this matters:**
- Works automatically after `innerHTML` replacement -- no re-binding needed
- One listener instead of N listeners per render
- Catches events from dynamically inserted elements
- Uses `closest()` to find the nearest ancestor with the attribute,
  so clicks on child elements (like an icon inside a button) still work

### Supported Events

| Attribute | HTML Element | Browser Event | Params Sent |
|---|---|---|---|
| `bv-click` | Any clickable element | `click` | `{}` |
| `bv-change` | `<input>`, `<select>`, `<textarea>` | `change` | `{ [name]: value }` |
| `bv-submit` | `<form>` | `submit` | All form field values |
| `bv-keydown` | `<input>`, `<textarea>` | `keydown` | `{ key, [name]: value }` |

### Automatic Reconnection

When the WebSocket closes (server restart, network issue), `blaze.js`
reconnects with exponential backoff:

```
Disconnect -> wait 200ms -> reconnect
Fail again -> wait 400ms -> reconnect
Fail again -> wait 800ms -> reconnect
...
Fail again -> wait 5000ms -> reconnect (max)
Success    -> reset delay to 200ms
```

This matches the pattern used by Phoenix's `phoenix.js`.

### Static File Serving

The server now serves files from the `public/` directory at `/public/*`:

```
GET /public/blaze.js -> reads public/blaze.js -> serves with correct MIME type
```

Security: Path traversal is prevented by normalizing the path and checking
it stays within the `public/` directory.

### The `__dirname` ESM Workaround

In ESM modules (which Blaze uses -- `"type": "module"` in `package.json`),
`__dirname` and `__filename` are not available. We need to derive them:

```typescript
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
```

`import.meta.url` gives the file URL (e.g., `file:///path/to/server.ts`),
`fileURLToPath()` converts it to a filesystem path, and `dirname()` gets
the directory. We use this to locate the `public/` directory relative to
the source file.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Client library | `phoenix.js` | `blaze.js` | `blaze.js` |
| Event binding | `phx-click`, `phx-change` | `bv-click`, `bv-change` | `bv-click`, `bv-change` |
| Delegation | Phoenix handles via hooks | Container-level delegation | Container-level delegation |
| Static serving | `Plug.Static` | `Bun.file()` | `readFileSync()` + MIME |
| Reconnection | Built into phoenix.js | Exponential backoff | Exponential backoff |
| Config | Data attributes | `data-path` | `data-path` |

## The Code

### `public/blaze.js` -- Client Library

This is the full file. Create it in the `public/` directory at the project
root.

```javascript
/**
 * Blaze Client -- Frontend JS glue for LiveView.
 *
 * Connects to the server via WebSocket, receives rendered HTML,
 * and sends user events (clicks, changes, form submissions) back.
 *
 * Features:
 * - Event delegation (single listener on container, not per-element)
 * - Supports bv-click, bv-change, bv-submit, bv-keydown
 * - Automatic reconnection with exponential backoff
 * - Connection status display
 */
(function () {
  "use strict";

  const container = document.getElementById("blaze-container");
  const statusEl = document.getElementById("blaze-status");
  const path = container?.getAttribute("data-path");

  if (!container || !path) return;

  // ── Reconnection state ──
  let ws = null;
  let reconnectDelay = 200; // Start at 200ms, max 5s
  const MAX_DELAY = 5000;
  let reconnectTimer = null;

  // ── WebSocket connection ──

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + location.host + "/live/websocket?path=" + encodeURIComponent(path);

    ws = new WebSocket(url);

    ws.onopen = function () {
      reconnectDelay = 200; // Reset on successful connect
      setStatus("Connected", "connected");
    };

    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "render") {
        container.innerHTML = msg.html;
      }
    };

    ws.onclose = function () {
      setStatus("Disconnected — reconnecting...", "disconnected");
      scheduleReconnect();
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
      // Exponential backoff: 200 -> 400 -> 800 -> 1600 -> 3200 -> 5000
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    }, reconnectDelay);
  }

  function setStatus(text, className) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = "status " + className;
    }
  }

  // ── Send event to server ──

  function sendEvent(event, params) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "event", event: event, params: params || {} }));
    }
  }

  // ── Event delegation ──
  // One listener on the container handles all bv-* events.
  // This works even after innerHTML replacement (no re-binding needed).

  // bv-click: <button bv-click="increment">+</button>
  container.addEventListener("click", function (e) {
    var target = e.target.closest("[bv-click]");
    if (target) {
      var event = target.getAttribute("bv-click");
      sendEvent(event);
    }
  });

  // bv-change: <input bv-change="update_name">
  container.addEventListener("change", function (e) {
    var target = e.target.closest("[bv-change]");
    if (target) {
      var event = target.getAttribute("bv-change");
      var value = target.value;
      var name = target.getAttribute("name") || "value";
      var params = {};
      params[name] = value;
      sendEvent(event, params);
    }
  });

  // bv-submit: <form bv-submit="save">
  container.addEventListener("submit", function (e) {
    var form = e.target.closest("[bv-submit]");
    if (form) {
      e.preventDefault();
      var event = form.getAttribute("bv-submit");
      var formData = new FormData(form);
      var params = {};
      formData.forEach(function (value, key) {
        params[key] = value;
      });
      sendEvent(event, params);
    }
  });

  // bv-keydown: <input bv-keydown="search">
  container.addEventListener("keydown", function (e) {
    var target = e.target.closest("[bv-keydown]");
    if (target) {
      var event = target.getAttribute("bv-keydown");
      var name = target.getAttribute("name") || "value";
      var params = { key: e.key };
      params[name] = target.value;
      sendEvent(event, params);
    }
  });

  // ── Initialize ──
  connect();
})();
```

**Key decisions:**

- **IIFE wrapper:** `(function () { ... })()` prevents polluting the global
  scope. All state is local to the closure.
- **`data-path` configuration:** The LiveView path comes from the
  container's `data-path` attribute, not inline JS. This decouples
  the client from the server-generated HTML.
- **`closest()` for delegation:** Handles clicks on child elements
  within a `bv-click` element (e.g., icon inside a button).
- **Plain JS (no ES6 modules):** Loaded via `<script>` tag, works
  in all browsers without build tools.
- **`var` instead of `const`/`let` in delegation:** Uses `var` for
  broader browser compatibility in the event handlers.
- **`scheduleReconnect()` guards against duplicates:** The `if (reconnectTimer) return`
  check prevents multiple reconnection timers from stacking up.
- **`ws.onerror` calls `ws.close()`:** Error events don't close the socket
  automatically, so we close it to trigger the `onclose` handler which
  starts reconnection.

### `src/blaze/server.ts` -- Static File Serving + Updated HTML Shell

This is the full file. The changes from step 15 are:

1. New imports: `readFileSync`, `join`, `dirname`, `extname`, `normalize`, `fileURLToPath`
2. `__dirname` ESM workaround and `PUBLIC_DIR` constant
3. `MIME_TYPES` map for content-type headers
4. `serveStatic()` function with path traversal protection
5. Updated `liveViewPage()` -- uses `data-path` attribute and `<script src="/public/blaze.js">`
6. Static file check in the HTTP handler (before live route check)

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
import { readFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "./context.js";
import type { Router } from "./router.js";
import type { LiveViewClass, LiveConnection } from "./live_handler.js";
import { handleOpen, handleMessage, handleClose } from "./live_handler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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
 * Container div with data-path attribute, loads blaze.js client.
 */
function liveViewPage(path: string): string {
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
  <div id="blaze-container" data-path="${path}">Connecting...</div>
  <p class="status" id="blaze-status">Connecting...</p>
  <p><a href="/">← Back to home</a></p>

  <script src="/public/blaze.js"></script>
</body>
</html>`;
}

/**
 * Serve a static file from the public/ directory.
 * Returns true if the file was served, false if not found.
 */
function serveStatic(res: uWS.HttpResponse, filePath: string): boolean {
  // Prevent path traversal
  const normalized = normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(PUBLIC_DIR, normalized);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  try {
    const content = readFileSync(fullPath);
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";

    res.cork(() => {
      res.writeStatus("200");
      res.writeHeader("content-type", mime);
      res.end(content);
    });
    return true;
  } catch {
    return false;
  }
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

    // 2. Serve static files from public/ directory
    if (method === "GET" && path.startsWith("/public/")) {
      const filePath = path.slice("/public/".length);
      if (serveStatic(res, filePath)) return;
    }

    // 3. Check if this is a LiveView route (GET only)
    if (method === "GET" && liveRoutes.has(path)) {
      res.cork(() => {
        res.writeStatus("200");
        res.writeHeader("content-type", "text/html; charset=utf-8");
        res.end(liveViewPage(path));
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

**Key changes from Step 15:**

- **`__dirname` ESM workaround:** Uses `fileURLToPath(import.meta.url)` to
  derive `__dirname` since it's not available in ES modules.
- **`PUBLIC_DIR` constant:** Points to the `public/` directory at the
  project root, calculated relative to `server.ts` location
  (`src/blaze/server.ts` -> `../../public`).
- **`serveStatic()` function:** Reads a file from `public/`, sets the
  correct MIME type, and serves it. Returns `false` if the file doesn't
  exist (letting the request fall through to the router).
- **Path traversal protection:** `normalize()` resolves `..` segments, then
  we strip any leading `..` patterns and verify the resolved path stays
  within `PUBLIC_DIR`.
- **Static file check runs first:** In the HTTP handler, static file
  requests (`/public/*`) are checked before live routes. This ensures
  `blaze.js` is served before the HTML shell page renders.
- **Updated `liveViewPage()`:** Now uses `data-path` attribute on the
  container div and loads `blaze.js` via a `<script>` tag instead of
  inline JavaScript.

### Updated HTML Shell

The `liveViewPage()` function now generates this HTML:

```html
<div id="blaze-container" data-path="/counter">Connecting...</div>
<p class="status" id="blaze-status">Connecting...</p>
<script src="/public/blaze.js"></script>
```

The `data-path` attribute tells `blaze.js` which LiveView to connect to.
No more inline JavaScript.

## How It Works

### Request Flow for LiveView Pages

```
Browser: GET /counter
  -> Server: liveRoutes.has("/counter") -> true
  -> Serve HTML shell with <script src="/public/blaze.js">
  -> Browser loads blaze.js
    -> Reads data-path="/counter" from container
    -> Opens WebSocket to /live/websocket?path=/counter
    -> Server creates CounterLive instance
    -> mount() -> render() -> send { type: "render", html }
    -> blaze.js sets container.innerHTML
    -> Event delegation handles all bv-* clicks
```

### Static File Request Flow

```
Browser: GET /public/blaze.js
  -> Server: path starts with "/public/"
  -> serveStatic("blaze.js")
    -> normalize path (prevent traversal)
    -> readFileSync(PUBLIC_DIR + "/blaze.js")
    -> Look up MIME type for .js -> "application/javascript"
    -> res.cork() -> writeStatus("200") -> writeHeader -> res.end(content)
```

### Event Delegation Flow

```
User clicks <button bv-click="increment">+</button>
  -> click event bubbles up to #blaze-container
  -> Delegation listener fires
  -> e.target.closest("[bv-click]") finds the button
  -> Sends { type: "event", event: "increment", params: {} }
  -> Server: handleEvent("increment") -> count: 0 -> 1
  -> Server: render() -> HTML with count=1
  -> blaze.js: container.innerHTML = new HTML
  -> Next click works immediately (delegation, no re-binding)
```

### Reconnection Flow

```
WebSocket closes (server restart, network issue)
  -> ws.onclose fires
  -> setStatus("Disconnected - reconnecting...", "disconnected")
  -> scheduleReconnect()
    -> setTimeout(200ms) -> connect()
      -> If fails: setTimeout(400ms) -> connect()
        -> If fails: setTimeout(800ms) -> connect()
          -> ... up to 5000ms max
    -> On success: reconnectDelay resets to 200ms
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the counter

Open http://localhost:4001/counter -- the counter works exactly as before,
but now powered by `blaze.js` instead of inline JS.

### 3. Test reconnection

1. Click the counter a few times
2. Stop the server (Ctrl+C)
3. Watch the status change to "Disconnected -- reconnecting..."
4. Restart the server
5. The connection auto-restores (count resets since it's a new LiveView instance)

### 4. Verify static file serving

```bash
curl http://localhost:4001/public/blaze.js | head -5
# /**
#  * Blaze Client -- Frontend JS glue for LiveView.
```

### 5. Test path traversal protection

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4001/public/../package.json
# 404 (blocked)
```

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `public/blaze.js` | **New** | Client-side LiveView library with event delegation + reconnection |
| `src/blaze/server.ts` | **Modified** | Static file serving (`serveStatic`, `__dirname`, `MIME_TYPES`), updated HTML shell with `data-path` + `<script>` tag |

---

[← Previous: Step 15 - LiveView Base](15-liveview-base.md) | [Next: Step 17 - Diffing Engine →](17-diffing-engine.md)

## What's Next

The counter works with event delegation and auto-reconnection, but every
update sends the **full HTML** string. In **Step 17**, we'll add a
**diffing engine** -- tracking the previous render and sending only the
changed parts, dramatically reducing bandwidth for large views.
