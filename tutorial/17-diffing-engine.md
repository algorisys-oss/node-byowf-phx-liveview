# Step 17: Diffing Engine

[← Previous: Step 16 - Frontend JS Glue](16-frontend-js-glue.md) | [Next: Step 18 - Fine-Grained Diffing →](18-fine-grained-diffing.md)

---

## What We're Building

Until now, every LiveView update sent the **entire HTML string** over
WebSocket -- even if only one character changed. For a counter that goes
from 0 to 1, we were sending ~450 bytes of HTML when only 1 byte changed.

In this step, we add a **diffing engine** using tagged template literals.
The `bv` tagged template splits a template into **statics** (fixed string
parts) and **dynamics** (interpolated values). On the initial mount, both
are sent. On subsequent renders, only the **changed dynamics** are sent
as a sparse diff.

**Before (Step 16):**
```
Server → Client: { type: "render", html: "<h1>Live Counter</h1><p>42</p>..." }
                  ~450 bytes every time
```

**After (Step 17):**
```
Server → Client: { type: "mount", statics: [...], dynamics: ["0"] }
                  ~450 bytes once

Server → Client: { type: "diff", dynamics: { "0": "1" } }
                  ~29 bytes per update
```

### How This Compares to Ignite (Elixir)

In Phoenix LiveView, EEx templates are split at **compile time** into
statics and dynamics using the `~H` sigil and `HEEx` engine. The BEAM
tracks changes and sends only modified dynamics.

In Blaze, we achieve the same split at **runtime** using JavaScript's
tagged template literals. The `bv` function receives the string parts
and interpolated values separately -- no compiler needed.

```
Elixir:  ~H"<h1>Count: <%= @count %></h1>"  → compile-time split
Blaze:   bv`<h1>Count: ${count}</h1>`        → runtime split
```

## Concepts You'll Learn

### Tagged Template Literals

JavaScript's tagged template literals call a function with the static
parts and dynamic values separated:

```javascript
function bv(strings, ...values) {
  // strings = ["<h1>Count: ", "</h1>"]  ← statics (always the same)
  // values  = [42]                       ← dynamics (change per render)
  return { statics: Array.from(strings), dynamics: values.map(String) };
}

bv`<h1>Count: ${count}</h1>`
```

The statics never change between renders -- they're the template
structure. Only the dynamics (interpolated values) change.

### The Rendered Type

```typescript
interface Rendered {
  statics: string[];   // Template structure (sent once)
  dynamics: string[];  // Current values (diffed each render)
}
```

### Sparse Diffs

Instead of sending the full dynamics array each time, we compute a
**sparse diff** -- an object with only the changed indices:

```typescript
old dynamics: ["0", "Alice", "active"]
new dynamics: ["1", "Alice", "active"]
         diff: { "0": "1" }  ← only index 0 changed
```

If nothing changed, `diffDynamics()` returns `null` and nothing is sent.

### Wire Protocol

Three message types from server to client:

| Message | When | Content | Size |
|---|---|---|---|
| `mount` | First render | `{ statics, dynamics }` | Full template |
| `diff` | Subsequent renders | `{ dynamics: { "0": "1" } }` | Changed values only |
| `render` | Fallback (string) | `{ html: "..." }` | Full HTML |

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Template split | Compile-time (EEx) | Runtime (`bv` tag) | Runtime (`bv` tag) |
| Diff format | Sparse map | Sparse object | Sparse object |
| Initial send | Statics + dynamics | `mount` message | `mount` message |
| Update send | Changed dynamics | `diff` message | `diff` message |
| Type | `%Rendered{}` | `Rendered` | `Rendered` |

## The Code

### `src/blaze/rendered.ts` -- Tagged Template Engine

This is the complete file for Step 17. It provides the `Rendered` type,
the `bv` tagged template function, a type guard `isRendered()`, a
`buildHtml()` helper to reconstruct HTML from statics/dynamics, and
`diffDynamics()` to compute sparse diffs.

```typescript
/**
 * Blaze Rendered -- Tagged template engine for efficient diffing.
 *
 * Equivalent to Phoenix.LiveView.Rendered in the Elixir version.
 *
 * The `bv` tagged template function splits a template into:
 * - statics: the fixed string parts (never change between renders)
 * - dynamics: the interpolated values (change when assigns change)
 *
 * Example:
 *   bv`<h1>Count: ${count}</h1>`
 *   → { statics: ["<h1>Count: ", "</h1>"], dynamics: ["42"] }
 */

/**
 * A rendered template with split statics and dynamics.
 */
export interface Rendered {
  statics: string[];
  dynamics: string[];
}

/**
 * Tagged template literal that splits a template into statics and dynamics.
 */
export function bv(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Rendered {
  return {
    statics: Array.from(strings),
    dynamics: values.map(String),
  };
}

/**
 * Type guard: is this value a Rendered object?
 *
 * Used by the live handler to determine whether render() returned
 * a Rendered (for diffing) or a plain string (for full HTML send).
 */
export function isRendered(value: unknown): value is Rendered {
  return (
    typeof value === "object" &&
    value !== null &&
    "statics" in value &&
    "dynamics" in value &&
    Array.isArray((value as Rendered).statics) &&
    Array.isArray((value as Rendered).dynamics)
  );
}

/**
 * Reconstruct the full HTML from statics and dynamics.
 *
 * Zips statics and dynamics together:
 *   statics: ["<h1>", "</h1>"], dynamics: ["Hello"]
 *   → "<h1>Hello</h1>"
 */
export function buildHtml(statics: string[], dynamics: string[]): string {
  let html = statics[0] ?? "";
  for (let i = 0; i < dynamics.length; i++) {
    html += dynamics[i] + (statics[i + 1] ?? "");
  }
  return html;
}

/**
 * Compute a sparse diff between old and new dynamics.
 *
 * Returns an object mapping changed indices to their new values,
 * or null if nothing changed.
 *
 * Example:
 *   old: ["0", "Alice"]
 *   new: ["1", "Alice"]
 *   → { "0": "1" } (only index 0 changed)
 *
 *   old: ["0", "Alice"]
 *   new: ["0", "Alice"]
 *   → null (no changes)
 */
export function diffDynamics(
  oldDynamics: string[],
  newDynamics: string[],
): Record<string, string> | null {
  const diff: Record<string, string> = {};
  let hasChanges = false;

  for (let i = 0; i < newDynamics.length; i++) {
    if (oldDynamics[i] !== newDynamics[i]) {
      diff[String(i)] = newDynamics[i]!;
      hasChanges = true;
    }
  }

  return hasChanges ? diff : null;
}
```

**Key decisions:**

- **`bv` tagged template:** Named after the `bv-` event prefix.
  JavaScript calls this function with separated strings and values.
- **`dynamics: string[]`:** All values are stringified. This simplifies
  comparison and serialization.
- **`isRendered()` type guard:** The live handler needs to check whether
  `render()` returned a `Rendered` object or a plain string. This guard
  checks for the presence of `statics` and `dynamics` arrays.
- **Sparse diff object:** Uses string keys (`"0"`, `"1"`) not array
  indices, so unchanged positions are omitted entirely.
- **`null` for no changes:** If nothing changed, the handler skips
  sending a message.

### `src/blaze/live_view.ts` -- Updated Return Type

The `render()` method now returns `string | Rendered`:

```typescript
import type { Rendered } from "./rendered.js";

export abstract class LiveView {
  // ...

  /**
   * Return HTML string or Rendered object based on current assigns.
   * Called after mount() and after each handleEvent().
   *
   * Return a string for simple rendering (full HTML sent each time).
   * Return a Rendered object (via bv`...` tagged template) for
   * efficient diffing -- only changed dynamics are sent over the wire.
   */
  abstract render(assigns: Record<string, unknown>): string | Rendered;
}
```

### `src/blaze/live_handler.ts` -- Diff Tracking

The live handler tracks `prevDynamics` on each connection and uses
`isRendered()` and `diffDynamics()` to decide what to send.

Here is the relevant interface and the `sendUpdate()` function that
orchestrates mount vs diff vs string-render:

```typescript
import { isRendered, diffDynamics } from "./rendered.js";

/** Per-connection data stored in ws.getUserData() */
export interface LiveConnection {
  path: string;
  view?: LiveView;
  socket?: LiveViewSocket;
  /** Previous dynamics for diffing (only set when render() returns Rendered) */
  prevDynamics?: string[];
  /** PubSub subscriber callback for this connection */
  subscriber?: PubSub.Subscriber;
}

/**
 * Re-render a view and send diff (or full render) to the client.
 * Shared by handleEvent responses and PubSub handleInfo callbacks.
 */
function sendUpdate(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
): void {
  if (!data.view || !data.socket) return;

  const result = data.view.render(data.socket.assigns);

  if (isRendered(result)) {
    if (data.prevDynamics) {
      // Subsequent render: compute sparse diff
      const diff = diffDynamics(data.prevDynamics, result.dynamics);
      data.prevDynamics = result.dynamics;
      if (diff) {
        ws.send(JSON.stringify({ type: "diff", dynamics: diff }));
      }
    } else {
      // First render: send full statics + dynamics
      data.prevDynamics = result.dynamics;
      ws.send(JSON.stringify({
        type: "mount",
        statics: result.statics,
        dynamics: result.dynamics,
      }));
    }
  } else {
    // Plain string render (no diffing)
    data.prevDynamics = undefined;
    ws.send(JSON.stringify({ type: "render", html: result }));
  }
}
```

**How it's used:**

- `handleOpen()` calls `view.mount(socket)` then `sendUpdate()` -- this
  sends the initial `mount` message with statics and dynamics.
- `handleMessage()` calls `view.handleEvent()` then `sendUpdate()` --
  this computes a sparse diff and sends only changed dynamics.
- `handleClose()` clears `prevDynamics` along with the view and socket.

### `public/blaze.js` -- Client Diff Handling

The client stores `statics` and `dynamics`, rebuilds HTML from them,
and applies sparse diffs by updating only the changed indices:

```javascript
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

// Inside ws.onmessage handler:
ws.onmessage = function (e) {
  var msg = JSON.parse(e.data);

  if (msg.type === "mount") {
    statics = msg.statics;
    dynamics = msg.dynamics;
    container.innerHTML = buildHtml();
  } else if (msg.type === "diff") {
    if (dynamics && msg.dynamics) {
      // Apply only changed dynamics
      var keys = Object.keys(msg.dynamics);
      for (var i = 0; i < keys.length; i++) {
        dynamics[parseInt(keys[i], 10)] = msg.dynamics[keys[i]];
      }
      container.innerHTML = buildHtml();
    }
  } else if (msg.type === "render") {
    // Fallback for plain string renders
    statics = null;
    dynamics = null;
    container.innerHTML = msg.html;
  }
};
```

### `src/my_app/counter_live.ts` -- Using `bv` Template

The only change to the counter: `return bv\`...\`` instead of
`return \`...\``. The `bv` tag produces a `Rendered` object instead
of a plain string.

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
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}
```

## How It Works

### Mount Flow

```
WebSocket opens
  → mount() → assigns = { count: 0 }
  → render() → bv`...${0}...`
  → Rendered { statics: ["<h1>...", "...</h1>"], dynamics: ["0"] }
  → Send { type: "mount", statics: [...], dynamics: ["0"] }
  → Client stores statics, stores dynamics
  → Client builds HTML: statics[0] + dynamics[0] + statics[1]
  → Sets container.innerHTML
```

### Diff Flow

```
Client sends { type: "event", event: "increment" }
  → handleEvent() → count: 0 → 1
  → render() → bv`...${1}...`
  → Rendered { statics: [...], dynamics: ["1"] }
  → diffDynamics(["0"], ["1"]) → { "0": "1" }
  → Send { type: "diff", dynamics: { "0": "1" } }
  → Client: dynamics[0] = "1"
  → Client rebuilds HTML from statics + updated dynamics
  → Sets container.innerHTML
```

### Bandwidth Savings

For the counter template (~450 bytes of HTML):

| Action | Before (Step 16) | After (Step 17) |
|---|---|---|
| Mount | ~450 bytes | ~450 bytes |
| Each update | ~450 bytes | ~29 bytes |
| 100 clicks | ~45,000 bytes | ~3,350 bytes |
| **Savings** | -- | **93%** |

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the counter

Open http://localhost:4001/counter and click the buttons. It works
exactly the same as before -- but far more efficiently.

### 3. Inspect WebSocket frames

Open DevTools → Network → WS. Click on the WebSocket connection and
look at the Messages tab. You'll see:

1. First message: `mount` with statics and dynamics arrays
2. Subsequent messages: `diff` with only `{ "0": "1" }` etc.

### 4. Verify existing routes

```bash
curl http://localhost:4001/hello
# Hello, Blaze!
```

### 5. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/rendered.ts` | **New** | `Rendered` type, `bv` tagged template, `isRendered()`, `buildHtml()`, `diffDynamics()` |
| `src/blaze/live_view.ts` | **Modified** | `render()` returns `string \| Rendered` |
| `src/blaze/live_handler.ts` | **Modified** | Track `prevDynamics`, send mount/diff messages via `sendUpdate()` |
| `public/blaze.js` | **Modified** | Handle `mount`/`diff` messages, store statics, apply sparse diffs |
| `src/my_app/counter_live.ts` | **Modified** | Use `bv` tagged template in `render()` |

---

[← Previous: Step 16 - Frontend JS Glue](16-frontend-js-glue.md) | [Next: Step 18 - Fine-Grained Diffing →](18-fine-grained-diffing.md)

## What's Next

The diffing engine sends only changed values, but it still uses
`innerHTML` to replace the entire container. In **Step 18**, we'll
explore **fine-grained diffing** -- nested `Rendered` objects and
more granular updates. Then in **Step 19**, we'll integrate **morphdom**
for focus-preserving DOM patches instead of `innerHTML`.
