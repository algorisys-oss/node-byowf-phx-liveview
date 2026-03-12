# Step 22: LiveView Navigation

[← Previous: Step 21 - PubSub](21-pubsub.md) | [Next: Step 23 - LiveComponents →](23-live-components.md)

---

## What We're Building

Currently, navigating between LiveViews (counter, dashboard, shared
counter) requires a full page reload. The browser fetches a new HTML
page, loads all scripts, and reconnects the WebSocket from scratch.

In this step, we add **SPA-like navigation** between LiveViews:

1. `bv-navigate="/path"` -- client-side link interception
2. `history.pushState` -- URL updates without page reload
3. Browser back/forward support via `popstate`
4. `socket.pushRedirect(path)` -- server-initiated navigation
5. Route map injection so the client knows which paths are LiveViews

### How This Compares to Ignite (Elixir)

In Ignite, navigation uses `ignite-navigate` attributes. The controller
injects a JSON route map into the page as a data attribute. When a user
clicks a navigation link, ignite.js intercepts the click, closes the old
WebSocket, and opens a new one to the target LiveView path.

Blaze follows the same pattern: `bv-navigate`, `history.pushState`,
WebSocket swap, and route map injection.

## Concepts You'll Learn

### The Navigation Flow

```
User clicks <a bv-navigate="/dashboard">
       |
blaze.js intercepts click (preventDefault)
       |
Check liveRoutes["/dashboard"] → true (it's a LiveView)
       |
Close current WebSocket (suppress reconnect)
Reset statics/dynamics
       |
history.pushState({ path: "/dashboard" }, "", "/dashboard")
       |
Open new WebSocket to /live/websocket?path=/dashboard
       |
Server mounts DashboardLive → sends mount message
       |
morphdom patches the container with dashboard HTML
       |
URL shows /dashboard, no page reload happened
```

### Route Map Injection

The server injects a map of all registered LiveView paths into the HTML
page as a data attribute:

```html
<div id="blaze-container"
     data-path="/counter"
     data-live-routes="{&quot;/counter&quot;:true,&quot;/dashboard&quot;:true}">
</div>
```

The client parses this on init:

```javascript
var liveRoutes = JSON.parse(container.getAttribute("data-live-routes"));
```

When navigating, the client checks if the target is a LiveView. If not,
it falls back to a full page load (`window.location.href`).

### Graceful Degradation

The `bv-navigate` links have a regular `href` attribute too:

```html
<a href="/dashboard" bv-navigate="/dashboard">Dashboard</a>
```

- **With JavaScript:** `bv-navigate` intercepts, SPA-style navigation
- **Without JavaScript:** Regular link click, full page load
- **Right-click/Ctrl+click:** Opens in new tab (normal `href` behavior)

### Server-Initiated Navigation

A LiveView can redirect the client from the server:

```typescript
handleEvent(event, params, socket) {
  if (event === "login_success") {
    socket.pushRedirect("/dashboard");
  }
}
```

This sends `{ type: "redirect", path: "/dashboard" }` over WebSocket.
The client's `navigate()` handles it the same as a click.

### Comparison: Elixir vs Node.js

| Concept | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| Link attribute | `ignite-navigate` | `bv-navigate` |
| Route map | Controller `@live_routes` | `getLiveRoutesMap()` data attr |
| URL updates | `history.pushState` | Same |
| WS endpoint | Separate per LiveView | Single with `?path=` param |
| Server redirect | `push_redirect/2` via assigns | `socket.pushRedirect(path)` |
| Fallback | Full page load | Same |

## The Code

### 1. `src/blaze/live_view.ts` -- pushRedirect on LiveViewSocket

Add `pushRedirect` to the socket interface so LiveViews can trigger
server-initiated navigation:

```typescript
export interface LiveViewSocket {
  /** Current state (key-value pairs) */
  assigns: Record<string, unknown>;

  /** Merge new values into assigns */
  assign(newAssigns: Record<string, unknown>): void;

  /** Subscribe this LiveView to a PubSub topic */
  subscribe(topic: string): void;

  /** Broadcast a message to all other subscribers of a topic */
  broadcast(topic: string, message: unknown): void;

  /** Navigate the client to a different LiveView path (server-initiated) */
  pushRedirect(path: string): void;
}
```

### 2. `src/blaze/live_handler.ts` -- Route Map, Socket Wiring, Redirect Handling

Three pieces in the handler:

**`getLiveRoutesMap()`** -- builds a `{ "/counter": true, "/dashboard": true }` object
from the registered LiveView routes, used by the server to inject into the HTML page:

```typescript
/** Get a JSON map of all registered live routes (for client-side navigation). */
export function getLiveRoutesMap(liveRoutes: Map<string, LiveViewClass>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const routePath of liveRoutes.keys()) {
    map[routePath] = true;
  }
  return map;
}
```

**`pushRedirect` in `createSocket()`** -- stores the redirect path in a special
`__redirect__` assign so the handler can detect it after `handleEvent()`:

```typescript
function createSocket(subscriber: PubSub.Subscriber): LiveViewSocket {
  const socket: LiveViewSocket = {
    assigns: {},
    assign(newAssigns: Record<string, unknown>) {
      Object.assign(socket.assigns, newAssigns);
    },
    subscribe(topic: string) {
      PubSub.subscribe(topic, subscriber);
    },
    broadcast(topic: string, message: unknown) {
      PubSub.broadcast(topic, message, subscriber);
    },
    pushRedirect(redirectPath: string) {
      socket.assigns.__redirect__ = redirectPath;
    },
  };
  return socket;
}
```

**Redirect detection in `handleMessage()`** -- after calling `handleEvent()`, check
for `__redirect__`. If present, send a redirect message instead of a diff:

```typescript
export async function handleMessage(
  ws: WebSocket<LiveConnection>,
  message: ArrayBuffer,
  isBinary: boolean,
): Promise<void> {
  const data = ws.getUserData();
  if (!data.view || !data.socket) return;

  const copied = Buffer.from(new Uint8Array(message));

  let parsed: { type: string; event?: string; params?: Record<string, unknown> };
  try {
    parsed = JSON.parse(copied.toString("utf-8"));
  } catch {
    return;
  }

  if (parsed.type === "event" && parsed.event) {
    const eventName = parsed.event;

    // Parent LiveView event
    await data.view.handleEvent(eventName, parsed.params ?? {}, data.socket);

    // Check for server-initiated redirect
    const redirect = data.socket.assigns.__redirect__ as string | undefined;
    if (redirect) {
      delete data.socket.assigns.__redirect__;
      ws.send(JSON.stringify({ type: "redirect", path: redirect }));
    } else {
      sendUpdate(ws, data);
    }
  }
}
```

### 3. `src/blaze/server.ts` -- Route Map Injection into LiveView HTML

The server pre-computes the route map and injects it as an HTML-escaped
data attribute on the container div. The `liveViewPage()` function
generates the shell page:

```typescript
import { handleOpen, handleMessage, handleClose, getLiveRoutesMap } from "./live_handler.js";

// In serve():
const routeMap = htmlEscape(JSON.stringify(getLiveRoutesMap(liveRoutes)));

// ...

function liveViewPage(path: string, isDev: boolean, routeMap: string): string {
  const reloadScript = isDev
    ? `\n  <script src="${staticPath("blaze-reload.js")}"></script>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <title>Blaze LiveView</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    button { cursor: pointer; }
    .status { color: #999; font-size: 0.85em; margin-top: 1rem; }
    .status.connected { color: #2a2; }
    .status.disconnected { color: #c33; }
  </style>
</head>
<body>
  <div id="blaze-container" data-path="${path}" data-live-routes="${routeMap}">Connecting...</div>
  <p class="status" id="blaze-status">Connecting...</p>
  <p><a href="/">← Back to home</a></p>

  <script src="${staticPath("morphdom.min.js")}"></script>
  <script src="${staticPath("blaze.js")}"></script>${reloadScript}
</body>
</html>`;
}
```

The `htmlEscape()` helper ensures the JSON is safe inside an HTML attribute:

```typescript
function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

When the browser loads the page, the container has:
```html
<div id="blaze-container"
     data-path="/counter"
     data-live-routes="{&quot;/counter&quot;:true,&quot;/dashboard&quot;:true,&quot;/shared-counter&quot;:true}">
```

### 4. `public/blaze.js` -- Full Client Navigation Support

Here is the complete `blaze.js` with all navigation features. The key
additions are: parsing `data-live-routes`, the `navigate()` function,
`bv-navigate` click interception, `popstate` handling, and `redirect`
message handling.

```javascript
/**
 * Blaze Client -- Frontend JS glue for LiveView.
 *
 * Connects to the server via WebSocket, receives rendered HTML,
 * and sends user events (clicks, changes, form submissions) back.
 *
 * Features:
 * - Event delegation (single listener on container, not per-element)
 * - Supports bv-click, bv-change, bv-submit, bv-keydown, bv-navigate
 * - Automatic reconnection with exponential backoff
 * - Diffing: receives statics once on mount, then sparse dynamics diffs
 * - Morphdom: focus-preserving DOM patches (falls back to innerHTML)
 * - SPA-like navigation between LiveViews (history.pushState)
 * - Connection status display
 */
(function () {
  "use strict";

  var container = document.getElementById("blaze-container");
  var statusEl = document.getElementById("blaze-status");
  var path = container && container.getAttribute("data-path");

  if (!container || !path) return;

  // ── Route map ──
  // Parse live routes from data attribute so we know which paths
  // can be navigated client-side vs requiring a full page load.
  var liveRoutes = {};
  try {
    liveRoutes = JSON.parse(container.getAttribute("data-live-routes") || "{}");
  } catch (e) {}

  // ── Connection state ──
  var ws = null;
  var reconnectDelay = 200; // Start at 200ms, max 5s
  var MAX_DELAY = 5000;
  var reconnectTimer = null;
  var navigating = false; // Suppress reconnect during navigation

  // ── Diffing state ──
  var statics = null;   // string[] — fixed template parts (set on mount)
  var dynamics = null;   // string[] — current dynamic values

  /**
   * Rebuild full HTML from statics and dynamics arrays.
   */
  function buildHtml() {
    if (!statics || !dynamics) return "";
    var html = statics[0] || "";
    for (var i = 0; i < dynamics.length; i++) {
      html += dynamics[i] + (statics[i + 1] || "");
    }
    return html;
  }

  // ── WebSocket connection ──

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/live/websocket?path=" + encodeURIComponent(path);

    ws = new WebSocket(url);

    ws.onopen = function () {
      reconnectDelay = 200; // Reset on successful connect
      setStatus("Connected", "connected");
    };

    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);

      if (msg.type === "mount") {
        statics = msg.statics;
        dynamics = msg.dynamics;
        patch(buildHtml());
      } else if (msg.type === "diff") {
        if (dynamics && msg.dynamics) {
          var keys = Object.keys(msg.dynamics);
          for (var i = 0; i < keys.length; i++) {
            dynamics[parseInt(keys[i], 10)] = msg.dynamics[keys[i]];
          }
          patch(buildHtml());
        }
      } else if (msg.type === "render") {
        statics = null;
        dynamics = null;
        patch(msg.html);
      } else if (msg.type === "redirect") {
        // Server-initiated navigation
        navigate(msg.path);
      }
    };

    ws.onclose = function () {
      if (navigating) return; // Don't reconnect during navigation
      setStatus("Disconnected \u2014 reconnecting...", "disconnected");
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
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    }, reconnectDelay);
  }

  function setStatus(text, className) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = "status " + className;
    }
  }

  // ── Navigation ──
  // SPA-like navigation between LiveViews without full page reload.

  function navigate(targetPath) {
    // Non-LiveView routes → full page load
    if (!liveRoutes[targetPath]) {
      window.location.href = targetPath;
      return;
    }

    // Close current WebSocket (suppress reconnect)
    navigating = true;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }

    // Reset diffing state
    statics = null;
    dynamics = null;
    reconnectDelay = 200;

    // Update path and URL
    path = targetPath;
    container.dataset.path = targetPath;
    container.innerHTML = "Connecting...";
    history.pushState({ path: targetPath }, "", targetPath);

    // Connect to new LiveView
    navigating = false;
    connect();
  }

  // ── DOM patching ──

  function patch(html) {
    if (typeof morphdom === "function") {
      var wrapper = document.createElement("div");
      wrapper.id = container.id;
      if (container.dataset.path) {
        wrapper.dataset.path = container.dataset.path;
      }
      if (container.dataset.liveRoutes) {
        wrapper.dataset.liveRoutes = container.dataset.liveRoutes;
      }
      wrapper.innerHTML = html;

      morphdom(container, wrapper, {
        onBeforeElUpdated: function (fromEl, toEl) {
          if (fromEl === document.activeElement) {
            if (fromEl.tagName === "INPUT" || fromEl.tagName === "TEXTAREA"
                || fromEl.tagName === "SELECT") {
              toEl.value = fromEl.value;
              if (fromEl.selectionStart !== undefined) {
                toEl.selectionStart = fromEl.selectionStart;
                toEl.selectionEnd = fromEl.selectionEnd;
              }
            }
          }
          return true;
        },
      });
    } else {
      container.innerHTML = html;
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

  // bv-click and bv-navigate
  container.addEventListener("click", function (e) {
    // bv-navigate: SPA-like navigation between LiveViews
    var navTarget = e.target.closest("[bv-navigate]");
    if (navTarget) {
      e.preventDefault();
      var targetPath = navTarget.getAttribute("bv-navigate");
      navigate(targetPath);
      return;
    }

    // bv-click: send event to server
    var target = e.target.closest("[bv-click]");
    if (target) {
      var event = target.getAttribute("bv-click");
      sendEvent(event, {});
    }
  });

  // bv-change
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

  // bv-submit
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

  // bv-keydown
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

  // ── Browser history ──
  // Support back/forward buttons for SPA navigation.

  history.replaceState({ path: path }, "", path);

  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.path) {
      // Reconnect to the stored path without pushing new history
      navigating = true;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      statics = null;
      dynamics = null;
      reconnectDelay = 200;
      path = e.state.path;
      container.dataset.path = path;
      container.innerHTML = "Connecting...";
      navigating = false;
      connect();
    } else {
      window.location.reload();
    }
  });

  // ── Initialize ──
  connect();
})();
```

### 5. LiveView Templates -- Navigation Links

Each LiveView adds `bv-navigate` links to other LiveViews. The `href`
attribute provides a fallback for non-JS scenarios.

**`src/my_app/counter_live.ts`:**

```typescript
import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

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

  render(assigns: Record<string, unknown>): Rendered {
    return bv`
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
      <div style="margin-top: 1rem;">
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a>
      </div>
    `;
  }
}
```

**`src/my_app/dashboard_live.ts`** (render method excerpt):

```typescript
  render(assigns: Record<string, unknown>): Rendered {
    const countCard = statCard("Counter", assigns.count, "#e45");
    const clickCard = statCard("Total Clicks", assigns.clicks, "#36c");
    const msgCard = statCard("Message", assigns.message, "#2a9");

    return bv`
      <h1>Dashboard</h1>
      <div style="margin: 1rem 0;">
        ${countCard}
        ${clickCard}
        ${msgCard}
      </div>
      <div style="margin: 1rem 0;">
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <div style="margin: 1rem 0;">
        <label>Message: </label>
        <input bv-change="update_message" name="message" value="${assigns.message}"
               style="padding:0.4rem; font-size:1rem; border:1px solid #ccc; border-radius:4px;">
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        Each stat card is a nested bv\`\` template. Only changed values are sent as sparse diffs.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a>
      </div>
    `;
  }
```

**`src/my_app/shared_counter_live.ts`** (render method excerpt):

```typescript
  render(assigns: Record<string, unknown>): Rendered {
    return bv`
      <h1>Shared Counter</h1>
      <p style="font-size: 1.5rem; color: #333;">
        All connected tabs share this count: <strong>${assigns.count}</strong>
      </p>
      <div>
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        Open this page in multiple tabs — clicks sync across all of them.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a>
      </div>
    `;
  }
```

## How It Works

### Client-Side Navigation (bv-navigate)

```
1. User is on /counter (WebSocket connected)
2. Clicks "Dashboard" link with bv-navigate="/dashboard"
3. blaze.js intercepts click (preventDefault)
4. Checks liveRoutes["/dashboard"] → true
5. Closes /counter WebSocket (sets ws.onclose = null first to suppress reconnect)
6. Resets statics/dynamics to null
7. history.pushState → URL bar shows /dashboard
8. Opens new WebSocket: /live/websocket?path=/dashboard
9. Server mounts DashboardLive → sends statics + dynamics
10. morphdom patches container → dashboard rendered
11. No page reload, scripts stay loaded, instant transition
```

### Server-Initiated Navigation (pushRedirect)

```
1. User sends event (e.g., form submission)
2. handleEvent calls socket.pushRedirect("/dashboard")
3. pushRedirect sets assigns.__redirect__ = "/dashboard"
4. handleMessage detects __redirect__ in assigns
5. Sends { type: "redirect", path: "/dashboard" } instead of a diff
6. blaze.js receives redirect → calls navigate("/dashboard")
7. Same flow as client-side navigation
```

### Browser Back/Forward

```
1. User navigated: /counter → /dashboard → /shared-counter
2. History stack: [/counter, /dashboard, /shared-counter]
3. User clicks browser Back button
4. popstate fires with state: { path: "/dashboard" }
5. blaze.js closes current WS, resets state, sets path
6. Connects to /live/websocket?path=/dashboard
7. Server mounts DashboardLive → sends mount
8. URL shows /dashboard, no page reload
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the counter

Open http://localhost:4001/counter. You'll see navigation links at the
bottom: "Dashboard" and "Shared Counter".

### 3. Click a navigation link

Click "Dashboard". Watch:
- The URL changes to `/dashboard` instantly
- The page content swaps to the dashboard
- No page reload (check Network tab -- no HTML request)

### 4. Use browser back/forward

Click the browser's Back button. The counter reappears without a page
reload. Click Forward -- dashboard returns.

### 5. Right-click works normally

Right-click a `bv-navigate` link and select "Open in New Tab". It opens the
full page because the `href` attribute is still there.

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `public/blaze.js` | **Modified** | `navigate()`, `bv-navigate` binding, history/popstate, redirect handling |
| `src/blaze/live_view.ts` | **Modified** | `pushRedirect(path)` on LiveViewSocket |
| `src/blaze/live_handler.ts` | **Modified** | `getLiveRoutesMap()`, `__redirect__` handling in createSocket and handleMessage |
| `src/blaze/server.ts` | **Modified** | Inject `data-live-routes` into LiveView HTML shell page |
| `src/my_app/counter_live.ts` | **Modified** | Added `bv-navigate` links |
| `src/my_app/dashboard_live.ts` | **Modified** | Added `bv-navigate` links |
| `src/my_app/shared_counter_live.ts` | **Modified** | Added `bv-navigate` links |

---

[← Previous: Step 21 - PubSub](21-pubsub.md) | [Next: Step 23 - LiveComponents →](23-live-components.md)

## What's Next

In **Step 23**, we'll build **LiveComponents** -- reusable, composable
UI building blocks that can have their own state and event handlers,
similar to Phoenix LiveComponents.
