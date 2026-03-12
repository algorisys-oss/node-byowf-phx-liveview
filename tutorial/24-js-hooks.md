# Step 24: JS Hooks

[← Previous: Step 23 - LiveComponents](23-live-components.md) | [Next: Step 25 →](25-live-streams.md)

---

## What We're Building

LiveView handles most UI updates server-side, but sometimes you need
**client-side JavaScript** — timers, clipboard access, scroll position,
third-party libraries, animations. JS Hooks bridge this gap.

In this step we add:

1. **Hook definitions** — objects with `mounted()`, `updated()`, `destroyed()` callbacks
2. **Hook lifecycle management** — `processHooks()` runs after every DOM patch
3. **`pushEvent()`** — hooks can send events back to the server
4. **Cleanup** — `destroyAllHooks()` on navigation to prevent memory leaks

## Concepts You'll Learn

- Client-side lifecycle callbacks tied to DOM elements
- Prototypal inheritance for hook instances (`Object.create()`)
- Two-way communication: server pushes state, hooks push events back
- Memory leak prevention via cleanup on navigation and element removal

## The Code

### 1. Hook Definitions (`public/hooks.js`)

Hooks are registered on `window.BlazeHooks` before `blaze.js` loads:

```javascript
window.BlazeHooks = {
  CopyToClipboard: {
    mounted: function () {
      var self = this;
      this._handler = function () {
        var text = self.el.getAttribute("data-text") || "";
        navigator.clipboard.writeText(text).then(
          function () { self.pushEvent("clipboard_result", { success: "true", text: text }); },
          function () { self.pushEvent("clipboard_result", { success: "false" }); }
        );
      };
      this.el.addEventListener("click", this._handler);
    },
    destroyed: function () {
      if (this._handler) this.el.removeEventListener("click", this._handler);
    }
  },

  LocalTime: {
    mounted: function () {
      var self = this;
      var display = this.el.querySelector("[data-role='display']");
      this._interval = setInterval(function () {
        if (display) display.textContent = new Date().toLocaleTimeString();
      }, 1000);
    },
    updated: function () {
      // Re-query after morphdom may have replaced sub-elements
      var display = this.el.querySelector("[data-role='display']");
      if (display) display.textContent = new Date().toLocaleTimeString();
    },
    destroyed: function () {
      if (this._interval) clearInterval(this._interval);
    }
  }
};
```

**Key patterns:**
- Store references (`this._handler`, `this._interval`) for cleanup in `destroyed()`
- `this.el` — the DOM element with `bv-hook`
- `this.pushEvent(event, params)` — sends to server's `handleEvent()`

### 2. Hook Lifecycle in blaze.js (`public/blaze.js`)

```javascript
// State: track mounted hooks by element ID
var mountedHooks = {};

function createHookInstance(hookDef, el) {
  var instance = Object.create(hookDef);
  instance.el = el;
  instance.pushEvent = function (event, params) {
    sendEvent(event, params);
  };
  return instance;
}

function processHooks() {
  var hooks = window.BlazeHooks || {};
  var seenIds = {};

  // Scan for [bv-hook] elements
  container.querySelectorAll("[bv-hook]").forEach(function (el) {
    var hookName = el.getAttribute("bv-hook");
    var elId = el.id;
    if (!elId || !hookName) return;

    seenIds[elId] = true;
    var hookDef = hooks[hookName];
    if (!hookDef) return;

    var existing = mountedHooks[elId];
    if (existing) {
      existing.instance.el = el;  // Refresh after morphdom
      if (typeof existing.instance.updated === "function") {
        existing.instance.updated();
      }
    } else {
      var instance = createHookInstance(hookDef, el);
      mountedHooks[elId] = { name: hookName, instance: instance };
      if (typeof instance.mounted === "function") {
        instance.mounted();
      }
    }
  });

  // Destroy hooks whose elements were removed
  for (var id in mountedHooks) {
    if (!seenIds[id]) {
      var entry = mountedHooks[id];
      if (entry && typeof entry.instance.destroyed === "function") {
        entry.instance.destroyed();
      }
      delete mountedHooks[id];
    }
  }
}
```

Called at the end of every `patch()`. Also `destroyAllHooks()` during navigation.

### 3. HTML Requirements

Two attributes are required on hook elements:

```html
<button id="copy-btn" bv-hook="CopyToClipboard" data-text="Hello">
  Copy to Clipboard
</button>

<div id="local-time" bv-hook="LocalTime">
  <span data-role="display">Loading...</span>
  <button data-role="send">Send Time</button>
</div>
```

- **`id`** — hooks are tracked by element ID (required for identity)
- **`bv-hook="HookName"`** — must match a key in `window.BlazeHooks`

### 4. Server-Side Handling

Hook events arrive via `pushEvent()` and are handled identically to
regular `bv-click` events in the LiveView's `handleEvent()`:

```typescript
handleEvent(event, params, socket) {
  switch (event) {
    case "clipboard_result":
      // params.success, params.text
      break;
    case "local_time":
      // params.time
      break;
  }
}
```

No server-side changes needed — hooks reuse the existing event protocol.

### 5. Script Loading Order

```html
<script src="/public/morphdom.min.js"></script>
<script src="/public/hooks.js"></script>      <!-- defines window.BlazeHooks -->
<script src="/public/blaze.js"></script>       <!-- reads window.BlazeHooks -->
```

`hooks.js` must load before `blaze.js` so hooks are available on first mount.

## How It Works

```
Page loads → blaze.js connects → server sends mount message
  ↓
patch() renders HTML with <div id="local-time" bv-hook="LocalTime">
  ↓
processHooks() scans for [bv-hook] elements
  ↓
Creates instance via Object.create(LocalTime), sets el + pushEvent
  ↓
Calls instance.mounted() → starts setInterval (client-side clock)
  ↓
User clicks "Send Time" button (handled by hook, not bv-click)
  ↓
Hook calls this.pushEvent("local_time", { time: "2:30:45 PM" })
  ↓
Server handleEvent("local_time", { time: "2:30:45 PM" }, socket)
  ↓
Server updates assigns, re-renders, sends diff
  ↓
patch() updates DOM → processHooks() → calls updated() on existing hooks
  ↓
User navigates away → destroyAllHooks() → clearInterval cleanup
```

## Try It Out

```bash
npx tsx src/app.ts
# Visit http://localhost:4001/hooks
```

- The clock updates every second entirely client-side (no WebSocket traffic)
- Click "Send Time to Server" — time appears in the event log (server roundtrip)
- Click "Copy to Clipboard" — copies text, reports success/failure to server
- Change the text input, then copy again — new text is copied
- Navigate away and back — hooks are destroyed and re-mounted (no leaks)

## File Checklist

| File | Action | Purpose |
|------|--------|---------|
| `public/hooks.js` | **New** | Hook definitions (CopyToClipboard, LocalTime) |
| `src/my_app/hooks_demo_live.ts` | **New** | Demo LiveView with hook examples |
| `public/blaze.js` | Modified | processHooks(), destroyAllHooks(), hook lifecycle |
| `src/blaze/server.ts` | Modified | Added hooks.js script tag |
| `src/app.ts` | Modified | Added /hooks route |

## What's Next

In **Step 25**, we'll add **LiveView Streams** — efficient rendering of
large lists using `stream_insert` and `stream_delete` operations that
add/remove individual items without re-rendering the entire list.
