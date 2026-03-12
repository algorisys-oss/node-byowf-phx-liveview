# Step 20: Hot Code Reloader

[← Previous: Step 19 - Morphdom Integration](19-morphdom-integration.md) | [Next: Step 21 - PubSub →](21-pubsub.md)

---

## What We're Building

During development, you constantly edit code and want to see changes
immediately. Currently, after editing a file:

1. `tsx --watch` restarts the server
2. WebSocket connections drop
3. The client reconnects, but the page has stale HTML/JS
4. You have to manually refresh the browser

In this step, we add **automatic page reload on server restart**:

1. A dev-only `/live/reload` WebSocket endpoint
2. `blaze-reload.js` -- a tiny client that detects server restarts
3. When the server comes back after `tsx --watch` restart, the page
   automatically reloads with fresh code

### How This Compares to Ignite (Elixir)

In the Elixir version, hot code reloading is more powerful thanks to the
BEAM VM. The Ignite reloader is a GenServer that:

1. Polls `lib/**/*.ex` files for modification time changes
2. When a file changes, calls `Code.compile_file/1` to hot-swap the
   module **without restarting the server**
3. Existing WebSocket connections survive -- the new code is used on the
   next render

In Node.js, we can't hot-swap modules while running. Instead, we use
`tsx --watch` to restart the whole process and then automatically reload
the browser page. Different mechanism, same developer experience.

## Concepts You'll Learn

### The Reload Flow

```
Developer edits file
       ↓
tsx --watch detects change → restarts server process
       ↓
All WebSocket connections drop
       ↓
blaze-reload.js detects /live/reload WS closed
       ↓
Polls server with HEAD / every 300ms
       ↓
Server responds → page reload
       ↓
Fresh HTML, JS, and WebSocket connections
```

### Dev-Only Endpoint

The `/live/reload` WebSocket endpoint only exists when `dev: true`:

```typescript
if (dev) {
  app.ws("/live/reload", {
    open: (ws) => {
      ws.send(JSON.stringify({ type: "reload", status: "ready" }));
    },
    message: () => {},
    close: () => {},
  });
}
```

In production, the endpoint doesn't exist and `blaze-reload.js` is
not included in the HTML.

### Poll-Based Reconnection

When the WebSocket closes, the client can't immediately reconnect
because the server is still restarting. Instead, it polls with `HEAD /`:

```javascript
function pollUntilReady() {
  var timer = setInterval(function () {
    fetch("/", { method: "HEAD" })
      .then(function () {
        clearInterval(timer);
        location.reload();
      })
      .catch(function () {
        // Server not ready yet
      });
  }, 300);
}
```

`HEAD /` is lightweight -- no body, just checks if the server responds.
Once it does, `location.reload()` gets fresh everything.

### Conditional Script Loading

The LiveView HTML shell conditionally includes the reload script:

```typescript
function liveViewPage(path: string, isDev: boolean): string {
  const reloadScript = isDev
    ? `<script src="/public/blaze-reload.js"></script>`
    : "";
  return `...${reloadScript}...`;
}
```

### Comparison: Elixir vs Node.js

| Concept | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| Detection | GenServer polls file mtimes | `tsx --watch` detects changes |
| Mechanism | `Code.compile_file/1` hot-swap | Full process restart + page reload |
| Connections | Survive (same BEAM process) | Drop and reconnect (new process) |
| Client | No client needed | `blaze-reload.js` polls + reloads |
| Dev-only | Conditional supervisor child | `dev` flag controls endpoint + script |
| Latency | Instant (~50ms) | Restart + reload (~500ms) |

## The Code

### `public/blaze-reload.js` -- Dev Reload Client

```javascript
(function () {
  "use strict";

  var POLL_INTERVAL = 300;

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var ws = new WebSocket(proto + "//" + location.host + "/live/reload");

    ws.onopen = function () {
      console.log("[blaze-reload] connected");
    };

    ws.onclose = function () {
      console.log("[blaze-reload] server disconnected, waiting...");
      pollUntilReady();
    };
  }

  function pollUntilReady() {
    var timer = setInterval(function () {
      fetch("/", { method: "HEAD" })
        .then(function () {
          clearInterval(timer);
          console.log("[blaze-reload] server is back, reloading...");
          location.reload();
        })
        .catch(function () {});
    }, POLL_INTERVAL);
  }

  connect();
})();
```

**Key decisions:**

- **Separate from blaze.js:** The reload script is a standalone file,
  only loaded in dev mode. Zero overhead in production.
- **Poll with HEAD:** Minimal request -- no body, just connectivity check.
- **300ms interval:** Fast enough to feel instant, not so fast as to
  spam the server during restart.
- **No retry limit:** Keeps polling forever. The server will come back.

### `src/blaze/server.ts` -- Dev Reload Endpoint

```typescript
// Dev-only: hot reload WebSocket
if (dev) {
  app.ws("/live/reload", {
    open: (ws) => {
      ws.send(JSON.stringify({ type: "reload", status: "ready" }));
    },
    message: () => {},
    close: () => {},
  });
}
```

A separate uWS WebSocket route registered before the LiveView route.
The `open` handler sends a ready message so the client knows it's
connected. `message` and `close` are no-ops.

## How It Works

### Development (dev: true)

```
1. Start: npx tsx --watch src/app.ts
2. Browser loads /counter
   → HTML includes morphdom.min.js + blaze.js + blaze-reload.js
   → blaze.js connects to /live/websocket → LiveView active
   → blaze-reload.js connects to /live/reload → monitoring

3. Edit counter_live.ts and save
   → tsx --watch kills process, restarts
   → All WebSocket connections drop
   → blaze-reload.js: onclose fires → starts polling HEAD /
   → Server restarts in ~100ms
   → HEAD / succeeds → location.reload()
   → Fresh page with new code
```

### Production (dev: false)

```
1. Start: npx tsx src/app.ts  (with dev: false)
2. Browser loads /counter
   → HTML includes morphdom.min.js + blaze.js (NO blaze-reload.js)
   → /live/reload endpoint doesn't exist
   → Zero reload overhead
```

## Try It Out

### 1. Start the server in watch mode

```bash
npx tsx --watch src/app.ts
```

### 2. Open a LiveView page

Visit http://localhost:4001/counter. Open DevTools console -- you
should see `[blaze-reload] connected`.

### 3. Edit a file

Change something in `src/my_app/counter_live.ts`, for example, change
the heading from "Live Counter" to "My Counter":

```typescript
render(assigns) {
  return bv`
    <h1>My Counter</h1>
    ...
  `;
}
```

Save the file.

### 4. Watch the auto-reload

In the console you'll see:

```
[blaze-reload] server disconnected, waiting...
[blaze-reload] server is back, reloading...
```

The page refreshes automatically and shows "My Counter".

### 5. Verify production excludes reload

```bash
# Start without --watch, with dev: false
# (Change dev: false in serve() call or pass option)
npx tsx src/app.ts
```

View source on http://localhost:4001/counter -- no `blaze-reload.js`
script tag.

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `public/blaze-reload.js` | **New** | Dev-only auto-reload client |
| `src/blaze/server.ts` | **Modified** | `/live/reload` WS endpoint, conditional script loading |

---

[← Previous: Step 19 - Morphdom Integration](19-morphdom-integration.md) | [Next: Step 21 - PubSub →](21-pubsub.md)

## What's Next

This completes **Module 2: LiveView Core**. We now have:
- Server-rendered views that update in real-time (LiveView)
- Efficient wire protocol (statics/dynamics with sparse diffs)
- Focus-preserving DOM patches (morphdom)
- Automatic dev reload (tsx --watch + WebSocket)

In **Step 21**, we begin **Module 3: Broadcasting & Components** with
**PubSub** -- using uWebSockets.js native WebSocket topics to broadcast
messages across connected clients, like Phoenix's PubSub system.
