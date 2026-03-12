# Step 19: Morphdom Integration

[← Previous: Step 18 - Fine-Grained Diffing](18-fine-grained-diffing.md) | [Next: Step 20 - PubSub →](20-pubsub.md)

---

## What We're Building

Right now, every update replaces the entire container with `innerHTML`.
This works, but it has serious problems:

- **Input focus is lost** -- if you're typing in a text field and the
  server pushes an update, your cursor jumps and the field loses focus
- **CSS animations restart** -- any running transitions or animations
  are killed and restart from scratch
- **Scroll position resets** -- long scrollable content jumps back to top
- **Third-party widgets break** -- anything that stores state in DOM
  nodes is destroyed

In this step, we integrate **morphdom** -- a DOM diffing library that
compares old and new HTML and only patches the elements that actually
changed. This preserves focus, animations, scroll position, and
everything else.

### How This Compares to Ignite (Elixir)

Phoenix LiveView uses morphdom (via a fork called `phoenix_live_view.js`)
for the same reason. The Ignite version includes morphdom as a static
asset and uses the `onBeforeElUpdated` hook to preserve input focus.

In Blaze, we use the same approach: load morphdom before `blaze.js`,
and fall back to `innerHTML` if morphdom isn't available.

## Concepts You'll Learn

### What is Morphdom?

Morphdom is a lightweight (~12KB) library that efficiently updates a
DOM tree to match a target HTML structure. It walks both trees
simultaneously and:

1. **Adds** elements that exist in the new HTML but not the old
2. **Removes** elements that exist in the old HTML but not the new
3. **Updates** elements that exist in both but have changed attributes
4. **Skips** elements that are identical -- no unnecessary DOM mutations

### Getting Morphdom

Morphdom is available from npm or GitHub. To add it to your project:

**Option A: Download from npm (recommended)**

```bash
npm install morphdom
cp node_modules/morphdom/dist/morphdom-umd.min.js public/morphdom.min.js
```

After copying, you can remove the npm dependency if you prefer zero
runtime deps -- the file is self-contained (~12KB minified).

**Option B: Download from GitHub releases**

```bash
curl -o public/morphdom.min.js https://unpkg.com/morphdom@2.7.4/dist/morphdom-umd.min.js
```

**Option C: Use a CDN (not recommended for production)**

```html
<script src="https://unpkg.com/morphdom@2.7.4/dist/morphdom-umd.min.js"></script>
```

The file exposes a global `morphdom` function when loaded via a
`<script>` tag. No import/require needed -- it uses the UMD pattern.

### The onBeforeElUpdated Hook

Morphdom lets you intercept element updates. We use this to:

```javascript
morphdom(container, wrapper, {
  onBeforeElUpdated: function (fromEl, toEl) {
    // Skip file inputs — browsers don't allow setting their value
    if (fromEl.type === "file") return false;

    // Skip stream containers — their children are managed separately
    if (fromEl.hasAttribute && fromEl.hasAttribute("bv-stream")) return false;

    // Don't overwrite value if user is actively typing
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
```

**Focus preservation:** If the user is typing in an input, we copy the
current value FROM the old element TO the new element before morphdom
updates it. This means the server's value is overridden by what the user
is actually typing -- the right UX behavior.

**Cursor preservation:** We also save and restore `selectionStart` and
`selectionEnd` so the cursor position survives updates.

**File input protection:** File inputs can't have their value set
programmatically (browser security). We skip them entirely.

**Stream container protection:** Elements with `bv-stream` are managed
by the stream operations system, not by morphdom.

### Graceful Fallback

If morphdom fails to load, `blaze.js` falls back to `innerHTML`:

```javascript
if (typeof morphdom === "function") {
  morphdom(container, wrapper, { ... });
} else {
  container.innerHTML = html;
}
```

This means the app works everywhere, with morphdom as a progressive
enhancement.

### Script Loading Order

Morphdom must load before `blaze.js`. In `src/blaze/server.ts`, the
LiveView HTML shell loads scripts in this order:

```html
<script src="/public/morphdom.min.js"></script>
<script src="/public/blaze.js"></script>
```

### Comparison: Elixir vs Node.js

| Concept | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| DOM library | morphdom | Same: morphdom |
| Integration | `applyUpdate()` in ignite.js | `patch()` in blaze.js |
| Focus hook | `onBeforeElUpdated` | Same: `onBeforeElUpdated` |
| Fallback | `innerHTML` | Same: `innerHTML` |
| Loading | Static file via Cowboy | Static file from `public/` |
| Size | ~12KB minified | Same: ~12KB minified |

## The Code

### `public/blaze.js` -- Full File After Morphdom Integration

This is the complete `blaze.js` after this step. The key change is the
new `patch()` function that replaces all direct `container.innerHTML`
assignments, and the `onmessage` handler that calls `patch()`.

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
  // This is the key function changed in Step 19.
  // Uses morphdom for surgical DOM updates when available,
  // falls back to innerHTML when morphdom is not loaded.

  function patch(html) {
    if (typeof morphdom === "function") {
      // Create a wrapper element that matches the container's id and
      // data attributes. morphdom compares root elements by id, so
      // the wrapper must match for morphdom to morph INTO the container
      // rather than replacing it entirely.
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
          // Skip file inputs — browsers don't allow setting their value
          if (fromEl.type === "file") return false;
          // Skip stream containers — their children are managed by applyStreamOps
          if (fromEl.hasAttribute && fromEl.hasAttribute("bv-stream")) return false;
          // Preserve focus: if user is actively typing, keep their value
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
      // Fallback: full innerHTML replacement (loses focus, animations, etc.)
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
  // This works even after innerHTML/morphdom replacement (no re-binding needed).

  // bv-click: <button bv-click="increment">+</button>
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
      var value = target.getAttribute("bv-value");
      var params = value ? { value: value } : {};
      sendEvent(event, params);
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

### `src/blaze/server.ts` -- Script Loading Order

The LiveView HTML shell loads morphdom before blaze.js:

```typescript
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

The `staticPath()` helper resolves to `/public/filename.js`. Morphdom
loads first so the global `morphdom` function is available when
`blaze.js` initializes and checks `typeof morphdom === "function"`.

## How It Works

### Without Morphdom (innerHTML)

```
Server sends: <div><p>Count: 1</p><input value="hello"></div>

innerHTML:
  1. Destroy ALL child elements
  2. Parse new HTML
  3. Create ALL new elements
  → Input loses focus, cursor position lost, animations restart
```

### With Morphdom

```
Server sends: <div><p>Count: 1</p><input value="hello"></div>

morphdom:
  1. Compare <p>Count: 0</p> vs <p>Count: 1</p>
     → Only update text node "0" → "1"
  2. Compare <input value="hello"> vs <input value="hello">
     → No change → skip entirely
  → Input keeps focus, cursor stays, animations continue
```

### The Wrapper Pattern

Morphdom expects to compare two root elements. We can't just pass an
HTML string -- we need a DOM element. So we:

1. Create a `<div>` wrapper with the same `id` as the container
2. Set its `innerHTML` to the new HTML
3. Call `morphdom(container, wrapper, options)`
4. Morphdom sees the matching ids and morphs the children in place

We also copy `data-path` and `data-live-routes` to the wrapper so
morphdom doesn't see those as attribute changes.

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Test focus preservation on the dashboard

1. Open http://localhost:4001/dashboard
2. Click in the message input field and start typing
3. While typing, click the "+" button
4. **Without morphdom:** The input would lose focus after each click
5. **With morphdom:** The input keeps focus and your cursor stays put

### 3. Test with the counter

Open http://localhost:4001/counter -- the counter buttons work as
before, but now DOM updates are surgical.

### 4. Verify morphdom is loaded

Open DevTools console and type:

```javascript
typeof morphdom
// "function"
```

### 5. Test fallback

To test the fallback, temporarily remove the morphdom script tag and
reload. The app still works, just without focus preservation.

### 6. Inspect DOM mutations

Open DevTools → Elements panel. Click a counter button and watch:
- **Without morphdom:** The entire container subtree flashes (recreated)
- **With morphdom:** Only the count text node changes

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `public/morphdom.min.js` | **New** | Morphdom DOM diffing library (~12KB, from npm or unpkg) |
| `public/blaze.js` | **Modified** | New `patch()` function uses morphdom with focus preservation, falls back to `innerHTML` |
| `src/blaze/server.ts` | **Modified** | LiveView shell loads `morphdom.min.js` before `blaze.js` |

---

[← Previous: Step 18 - Fine-Grained Diffing](18-fine-grained-diffing.md) | [Next: Step 20 - PubSub →](20-pubsub.md)

## What's Next

With morphdom handling DOM updates, our LiveView stack is now
efficient and user-friendly. In **Step 20**, we'll add **PubSub** --
server-side publish/subscribe using uWebSockets.js native topics,
enabling real-time broadcasts across multiple connected clients.
