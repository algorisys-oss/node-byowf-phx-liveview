# Step 25: LiveView Streams

[← Previous: Step 24 - JS Hooks](24-js-hooks.md) | [Next: Step 26 →](26-stream-upsert-limit.md)

---

## What We're Building

Rendering large lists in LiveView is expensive -- every time an item is
added or removed, the entire list re-renders and diffs are sent over the
wire. For a 100-item list, adding one item means re-rendering all 100.

**Streams** solve this by bypassing the template entirely. Instead of
re-rendering lists, the server sends targeted DOM operations:

- `streamInsert` -- add an element (prepend or append)
- `streamDelete` -- remove an element by ID
- Upsert -- update an existing element in-place via morphdom
- Limit -- auto-prune oldest items when a cap is exceeded

## Concepts You'll Learn

- Stream state management (items, order, ops queue)
- Wire protocol extension (optional `streams` property on messages)
- DOM-level operations bypassing the template diff engine
- Upsert detection (server tracks known DOM IDs)
- Limit pruning (direction-aware: prune opposite end of insertion)

## The Code

### 1. Complete Stream Module (`src/blaze/stream.ts`)

This is the entire stream module. It manages server-side state and builds
wire payloads for the client. Each stream has a name, a render function,
an ID function, a set of known DOM IDs (for upsert detection), an ordered
list (for limit pruning), and a queue of pending operations.

```typescript
/**
 * Blaze LiveView Streams -- Efficient list rendering via DOM-level operations.
 *
 * Instead of re-rendering entire lists, streams send targeted insert/delete
 * operations that the client applies directly to the DOM.
 *
 * Usage in a LiveView:
 *   mount(socket) {
 *     socket.stream("events", [], { render: (e) => `<div id="events-${e.id}">${e.text}</div>` });
 *   }
 *   handleEvent("add", params, socket) {
 *     socket.streamInsert("events", { id: "1", text: "Hello" }, { at: 0 });
 *   }
 */

/** A single stream's server-side state */
export interface StreamState {
  name: string;
  renderFn: (item: any) => string;
  idFn: (item: any) => string;
  domPrefix: string;
  limit: number | null;
  /** Queued operations since last render */
  ops: StreamOp[];
  /** Set of known DOM IDs (for upsert detection) */
  items: Set<string>;
  /** Insertion order (for limit pruning) */
  order: string[];
}

export type StreamOp =
  | { type: "insert"; item: any; domId: string; at: number }
  | { type: "delete"; domId: string }
  | { type: "reset" };

export interface StreamInsertOpts {
  at?: number; // 0 = prepend, -1 = append (default)
}

export interface StreamInitOpts {
  render: (item: any) => string;
  id?: (item: any) => string;
  domPrefix?: string;
  limit?: number;
}

/** All streams state stored in assigns.__streams__ */
type StreamsMap = Record<string, StreamState>;

function getStreams(assigns: Record<string, unknown>): StreamsMap {
  if (!assigns.__streams__) assigns.__streams__ = {};
  return assigns.__streams__ as StreamsMap;
}

/**
 * Initialize a stream with a name, initial items, and options.
 * Must provide a `render` function that returns HTML for each item.
 * Each item's HTML MUST have a root element with `id="${domPrefix}-${item.id}"`.
 */
export function stream(
  assigns: Record<string, unknown>,
  name: string,
  initialItems: any[],
  opts: StreamInitOpts,
): void {
  const streams = getStreams(assigns);
  const idFn = opts.id ?? ((item: any) => String(item.id));
  const domPrefix = opts.domPrefix ?? name;
  const limit = opts.limit ?? null;

  const state: StreamState = {
    name,
    renderFn: opts.render,
    idFn,
    domPrefix,
    limit,
    ops: [],
    items: new Set(),
    order: [],
  };

  // Insert initial items
  for (const item of initialItems) {
    const domId = domPrefix + "-" + idFn(item);
    state.ops.push({ type: "insert", item, domId, at: -1 });
    state.items.add(domId);
    state.order.push(domId);
  }

  // Apply limit if needed
  if (limit !== null) {
    applyLimit(state, -1);
  }

  streams[name] = state;
}

/**
 * Insert (or update) an item in a stream.
 * If an item with the same DOM ID already exists, it's updated in-place (upsert).
 */
export function streamInsert(
  assigns: Record<string, unknown>,
  name: string,
  item: any,
  opts: StreamInsertOpts = {},
): void {
  const streams = getStreams(assigns);
  const state = streams[name];
  if (!state) throw new Error(`Stream "${name}" not initialized. Call stream() first.`);

  const at = opts.at ?? -1;
  const domId = state.domPrefix + "-" + state.idFn(item);
  const isUpdate = state.items.has(domId);

  state.ops.push({ type: "insert", item, domId, at });
  state.items.add(domId);

  if (!isUpdate) {
    // New item: add to order
    if (at === 0) {
      state.order.unshift(domId);
    } else {
      state.order.push(domId);
    }
    // Apply limit (may auto-prune oldest)
    if (state.limit !== null) {
      applyLimit(state, at);
    }
  }
}

/**
 * Delete an item from a stream.
 */
export function streamDelete(
  assigns: Record<string, unknown>,
  name: string,
  item: any,
): void {
  const streams = getStreams(assigns);
  const state = streams[name];
  if (!state) throw new Error(`Stream "${name}" not initialized. Call stream() first.`);

  const domId = state.domPrefix + "-" + state.idFn(item);
  state.ops.push({ type: "delete", domId });
  state.items.delete(domId);
  const idx = state.order.indexOf(domId);
  if (idx >= 0) state.order.splice(idx, 1);
}

/**
 * Extract pending stream operations and build the wire payload.
 * Clears ops after extraction. Returns null if no streams have pending ops.
 */
export function extractStreamOps(
  assigns: Record<string, unknown>,
): Record<string, any> | null {
  const streams = getStreams(assigns);
  const payload: Record<string, any> = {};
  let hasOps = false;

  for (const name in streams) {
    const state = streams[name]!;
    if (state.ops.length === 0) continue;

    const result = buildStreamPayload(state);
    if (result) {
      payload[name] = result;
      hasOps = true;
    }
    // Clear ops after extraction
    state.ops = [];
  }

  return hasOps ? payload : null;
}

/** Build the wire payload for a single stream's pending operations. */
function buildStreamPayload(state: StreamState): Record<string, any> | null {
  let hasReset = false;
  const inserts: { id: string; html: string; at?: number }[] = [];
  const deletes: string[] = [];

  for (const op of state.ops) {
    switch (op.type) {
      case "reset":
        hasReset = true;
        inserts.length = 0;
        deletes.length = 0;
        break;
      case "insert": {
        const html = state.renderFn(op.item);
        const entry: { id: string; html: string; at?: number } = { id: op.domId, html };
        if (op.at === 0) entry.at = 0;
        inserts.push(entry);
        break;
      }
      case "delete":
        deletes.push(op.domId);
        break;
    }
  }

  const result: Record<string, any> = {};
  if (hasReset) result.reset = true;
  if (inserts.length > 0) result.inserts = inserts;
  if (deletes.length > 0) result.deletes = deletes;

  return Object.keys(result).length > 0 ? result : null;
}

/** Prune excess items when a stream exceeds its limit. */
function applyLimit(state: StreamState, insertAt: number): void {
  if (state.limit === null) return;

  while (state.order.length > state.limit) {
    // Prune from opposite end of insertion
    const pruneIdx = insertAt === 0 ? state.order.length - 1 : 0;
    const domId = state.order[pruneIdx]!;
    state.order.splice(pruneIdx, 1);
    state.items.delete(domId);
    state.ops.push({ type: "delete", domId });
  }
}
```

### 2. LiveViewSocket Stream Methods (`src/blaze/live_view.ts`)

Add the three stream methods to the socket interface:

```typescript
import type { StreamInitOpts, StreamInsertOpts } from "./stream.js";

export interface LiveViewSocket {
  // ...existing methods (assign, subscribe, broadcast, pushRedirect)...

  /** Initialize a stream for efficient list rendering */
  stream(name: string, initialItems: any[], opts: StreamInitOpts): void;

  /** Insert (or upsert) an item into a stream */
  streamInsert(name: string, item: any, opts?: StreamInsertOpts): void;

  /** Delete an item from a stream */
  streamDelete(name: string, item: any): void;
}
```

### 3. Server Wire Protocol Changes (`src/blaze/live_handler.ts`)

Three changes to the handler:

**Import the stream module:**

```typescript
import * as Stream from "./stream.js";
```

**Wire stream methods into `createSocket()`:**

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
    stream(name: string, initialItems: any[], opts: Stream.StreamInitOpts) {
      Stream.stream(socket.assigns, name, initialItems, opts);
    },
    streamInsert(name: string, item: any, opts?: Stream.StreamInsertOpts) {
      Stream.streamInsert(socket.assigns, name, item, opts);
    },
    streamDelete(name: string, item: any) {
      Stream.streamDelete(socket.assigns, name, item);
    },
  };
  return socket;
}
```

**Extract stream ops in `sendUpdate()` and include them in messages:**

```typescript
function sendUpdate(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
): void {
  if (!data.view || !data.socket) return;

  const result = data.view.render(data.socket.assigns);
  const streamsPayload = Stream.extractStreamOps(data.socket.assigns);

  if (isRendered(result)) {
    if (data.prevDynamics) {
      const diff = diffDynamics(data.prevDynamics, result.dynamics);
      data.prevDynamics = result.dynamics;
      if (diff || streamsPayload) {
        const msg: Record<string, any> = { type: "diff" };
        if (diff) msg.dynamics = diff;
        if (streamsPayload) msg.streams = streamsPayload;
        ws.send(JSON.stringify(msg));
      }
    } else {
      data.prevDynamics = result.dynamics;
      const msg: Record<string, any> = {
        type: "mount",
        statics: result.statics,
        dynamics: result.dynamics,
      };
      if (streamsPayload) msg.streams = streamsPayload;
      ws.send(JSON.stringify(msg));
    }
  } else {
    data.prevDynamics = undefined;
    const msg: Record<string, any> = { type: "render", html: result };
    if (streamsPayload) msg.streams = streamsPayload;
    ws.send(JSON.stringify(msg));
  }
}
```

Key detail: a diff message can have `streams` even when `dynamics` is null
(e.g., only a stream insert occurred, no template changes). The condition
`if (diff || streamsPayload)` ensures we still send the message.

### 4. `bv-value` Attribute Support

Stream items need to pass data back to the server (e.g., which item to
delete). The `bv-value` attribute on `bv-click` elements sends a `value`
parameter with the event:

```html
<button bv-click="delete" bv-value="42">x</button>
```

Sends: `{ type: "event", event: "delete", params: { value: "42" } }`

In `public/blaze.js`, the click handler reads this attribute:

```javascript
// bv-click: send event to server
var target = e.target.closest("[bv-click]");
if (target) {
  var event = target.getAttribute("bv-click");
  var value = target.getAttribute("bv-value");
  var params = value ? { value: value } : {};
  sendEvent(event, params);
}
```

### 5. Client-Side Stream Handling (`public/blaze.js`)

The `applyStreamOps()` function runs after every mount/diff/render
message. It processes insert, delete, and reset operations on stream
containers (elements with `bv-stream="name"`).

Morphdom skips `bv-stream` containers during regular patching -- their
children are managed exclusively by `applyStreamOps`.

```javascript
// ── Stream operations ──
// Apply stream insert/delete/reset operations from a server message.
// Stream containers are marked with bv-stream="name" in the DOM.

function applyStreamOps(msg) {
  if (!msg.streams) return;

  for (var streamName in msg.streams) {
    var ops = msg.streams[streamName];
    var streamContainer = document.querySelector('[bv-stream="' + streamName + '"]');
    if (!streamContainer) continue;

    // Reset: remove all children
    if (ops.reset) {
      while (streamContainer.firstChild) {
        streamContainer.removeChild(streamContainer.firstChild);
      }
    }

    // Deletes: remove elements by DOM ID
    if (ops.deletes) {
      for (var i = 0; i < ops.deletes.length; i++) {
        var el = document.getElementById(ops.deletes[i]);
        if (el) el.parentNode.removeChild(el);
      }
    }

    // Inserts: add new elements (or update existing via morphdom)
    if (ops.inserts) {
      for (var j = 0; j < ops.inserts.length; j++) {
        var entry = ops.inserts[j];
        var temp = document.createElement("div");
        temp.innerHTML = entry.html.trim();
        var newEl = temp.firstChild;

        var existing = document.getElementById(entry.id);
        if (existing) {
          // Upsert: morphdom patch in place
          if (typeof morphdom === "function") {
            morphdom(existing, newEl, {
              onBeforeElUpdated: function (fromEl) {
                if (fromEl.type === "file") return false;
                return true;
              },
            });
          } else {
            existing.parentNode.replaceChild(newEl, existing);
          }
        } else if (entry.at === 0) {
          streamContainer.insertBefore(newEl, streamContainer.firstChild);
        } else {
          streamContainer.appendChild(newEl);
        }
      }
    }
  }
}
```

The morphdom `onBeforeElUpdated` callback in the main `patch()` function
must also skip stream containers:

```javascript
morphdom(container, wrapper, {
  onBeforeElUpdated: function (fromEl, toEl) {
    if (fromEl.type === "file") return false;
    // Skip stream containers — their children are managed by applyStreamOps
    if (fromEl.hasAttribute && fromEl.hasAttribute("bv-stream")) return false;
    // ...focus preservation...
    return true;
  },
});
```

`applyStreamOps()` is called after every patch in the message handler:

```javascript
ws.onmessage = function (e) {
  var msg = JSON.parse(e.data);

  if (msg.type === "mount") {
    statics = msg.statics;
    dynamics = msg.dynamics;
    patch(buildHtml());
    applyStreamOps(msg);
  } else if (msg.type === "diff") {
    if (dynamics && msg.dynamics) {
      // ...apply dynamics diff...
      patch(buildHtml());
    }
    applyStreamOps(msg);
  } else if (msg.type === "render") {
    statics = null;
    dynamics = null;
    patch(msg.html);
    applyStreamOps(msg);
  }
  // ...
};
```

### 6. Demo LiveView (`src/my_app/stream_demo_live.ts`)

A complete demo showing prepend, append, upsert, delete, and limit:

```typescript
/**
 * StreamDemoLive -- Demonstrates LiveView Streams with upsert and limit.
 *
 * Features:
 * - Stream with limit: 20 (auto-prunes when exceeded)
 * - Prepend/append operations
 * - Upsert: "Update Latest" modifies an existing item in-place
 * - Manual delete via bv-value
 * - Event count tracked separately from stream
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

let nextId = 1;

function makeEvent(text: string, type: string = "info") {
  return {
    id: String(nextId++),
    text,
    type,
    time: new Date().toLocaleTimeString(),
  };
}

const TYPE_COLORS: Record<string, string> = {
  info: "#e45",
  warning: "#e90",
  success: "#2a2",
};

function renderEvent(event: { id: string; text: string; type: string; time: string }) {
  const color = TYPE_COLORS[event.type] || "#e45";
  return `<div id="events-${event.id}" style="padding:0.4rem 0.6rem; margin:0.2rem 0;
                background:${event.type === "warning" ? "#fff8e0" : "#f8f8f8"}; border-radius:4px; border-left:3px solid ${color};
                display:flex; justify-content:space-between; align-items:center;">
          <span><strong>#${event.id}</strong> ${event.text}</span>
          <span style="display:flex; align-items:center; gap:0.5rem;">
            <span style="color:#999; font-size:0.8rem;">${event.time}</span>
            <button bv-click="delete" bv-value="${event.id}"
                    style="padding:0.1rem 0.4rem; font-size:0.75rem; background:#c33;
                           color:white; border:none; border-radius:3px; cursor:pointer;">x</button>
          </span>
        </div>`;
}

export class StreamDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    const initial = [
      makeEvent("Stream initialized"),
      makeEvent("Welcome to LiveView Streams"),
      makeEvent("Events appear here in real-time"),
    ];

    socket.assign({ count: initial.length, latestId: String(nextId - 1) });
    socket.stream("events", initial, {
      render: renderEvent,
      limit: 20,
    });
  }

  handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const count = socket.assigns.count as number;

    switch (event) {
      case "add": {
        const evt = makeEvent(`User event #${count + 1}`);
        socket.assign({ count: count + 1, latestId: evt.id });
        socket.streamInsert("events", evt, { at: 0 });
        break;
      }
      case "add_bottom": {
        const evt = makeEvent(`Appended event #${count + 1}`);
        socket.assign({ count: count + 1, latestId: evt.id });
        socket.streamInsert("events", evt);
        break;
      }
      case "update_latest": {
        const latestId = socket.assigns.latestId as string;
        if (latestId) {
          const updated = {
            id: latestId,
            text: "UPDATED \u2014 modified in-place via upsert",
            type: "warning",
            time: new Date().toLocaleTimeString(),
          };
          socket.streamInsert("events", updated);
        }
        break;
      }
      case "delete": {
        const id = params.value as string;
        socket.streamDelete("events", { id });
        socket.assign({ count: Math.max(0, count - 1) });
        break;
      }
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const count = assigns.count as number;
    return bv`
      <h1>LiveView Streams</h1>
      <p>Events in stream: <strong>${count}</strong> <span style="color:#999; font-size:0.85rem;">(limit: 20)</span></p>
      <p>
        <button bv-click="add" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#e45; color:white; border:none; border-radius:4px;">
          Prepend Event
        </button>
        <button bv-click="add_bottom" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#36c; color:white; border:none; border-radius:4px; margin-left:0.5rem;">
          Append Event
        </button>
        <button bv-click="update_latest" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#e90; color:white; border:none; border-radius:4px; margin-left:0.5rem;">
          Update Latest
        </button>
      </p>
      <div bv-stream="events" style="max-height:400px; overflow-y:auto; border:1px solid #ddd;
                                      border-radius:6px; padding:0.5rem;"></div>
      <p style="color: #888; font-size: 0.85rem; margin-top: 1rem;">
        Streams bypass the template — items are inserted/deleted directly in the DOM.
        Limit: 20 items (oldest pruned automatically). "Update Latest" upserts in-place via morphdom.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a>
      </div>
    `;
  }
}
```

Note the `<div bv-stream="events">` in the template. This is the stream
container. Its children are managed entirely by stream operations -- the
template never touches them. The render function builds only the template
around it (count display, buttons), while `applyStreamOps()` manages the
list items.

## How It Works

### Wire Protocol

Stream operations ride alongside the regular diff protocol. Every message
type (`mount`, `diff`, `render`) can optionally include a `streams` property:

```json
{
  "type": "mount",
  "statics": ["<h1>Events: <strong>", "</strong>...</h1><div bv-stream=\"events\"></div>"],
  "dynamics": ["3"],
  "streams": {
    "events": {
      "inserts": [
        { "id": "events-1", "html": "<div id=\"events-1\">...</div>" },
        { "id": "events-2", "html": "<div id=\"events-2\">...</div>" },
        { "id": "events-3", "html": "<div id=\"events-3\">...</div>" }
      ]
    }
  }
}
```

A diff with only stream changes (no template dynamics changed):

```json
{
  "type": "diff",
  "streams": {
    "events": {
      "inserts": [{ "id": "events-4", "html": "<div id=\"events-4\">New!</div>", "at": 0 }],
      "deletes": ["events-1"]
    }
  }
}
```

### Data Flow

```
mount() → socket.stream("events", [...3 items...], { render, limit: 20 })
  ↓
stream() creates StreamState, queues 3 insert ops
  ↓
sendUpdate() calls render() → then extractStreamOps() builds payload
  ↓
Server sends: { type: "mount", statics, dynamics, streams: { events: { inserts: [...] } } }
  ↓
Client: patch(html) creates <div bv-stream="events"></div>
        applyStreamOps() inserts 3 items into the container
  ↓
User clicks "Prepend Event"
  ↓
handleEvent("add") → socket.streamInsert("events", newItem, { at: 0 })
  ↓
streamInsert() queues insert op, adds to items Set and order array
  ↓
sendUpdate() → extractStreamOps() returns { events: { inserts: [{ id, html, at: 0 }] } }
  ↓
Server sends: { type: "diff", dynamics: { "0": "4" }, streams: { events: { inserts: [...] } } }
  ↓
Client: patch() updates count display, applyStreamOps() prepends new item
  ↓
When stream has > 20 items: applyLimit() auto-generates delete for oldest
  ↓
Server sends: { streams: { events: { inserts: [...], deletes: ["events-1"] } } }
  ↓
Client: removes oldest item, adds new one — bounded list maintained
```

### Upsert Detection

When `streamInsert()` is called with an item whose DOM ID already exists
in the `items` Set, it's treated as an upsert. The item is re-rendered
and sent as an insert. On the client, `applyStreamOps()` finds the
existing element by `document.getElementById(entry.id)` and uses morphdom
to patch it in place rather than appending/prepending.

### Limit Pruning

When a stream has a `limit` and the item count exceeds it, `applyLimit()`
prunes from the **opposite end** of insertion:

- Prepend (`at: 0`) -- prunes from the bottom (end of order array)
- Append (`at: -1`) -- prunes from the top (start of order array)

This keeps the most recently visible items in view.

## Try It Out

```bash
npx tsx src/app.ts
# Visit http://localhost:4001/streams
```

- Click "Prepend Event" rapidly -- items appear at the top
- Click "Append Event" -- items appear at the bottom
- Click "Update Latest" -- the last-added item updates in-place (yellow highlight)
- Click "x" on any item -- it's removed from the DOM
- Add more than 20 items -- oldest items are automatically pruned
- Open DevTools Network tab -- only the new item's HTML is sent, not the whole list

## File Checklist

| File | Action | Purpose |
|------|--------|---------|
| `src/blaze/stream.ts` | **New** | Stream state, ops queue, wire payload builder |
| `src/my_app/stream_demo_live.ts` | **New** | Demo with prepend/append/upsert/delete/limit |
| `src/blaze/live_view.ts` | Modified | Added stream/streamInsert/streamDelete to socket |
| `src/blaze/live_handler.ts` | Modified | Wired stream methods, extractStreamOps in sendUpdate |
| `public/blaze.js` | Modified | applyStreamOps(), bv-value, morphdom bv-stream skip |
| `src/app.ts` | Modified | Added /streams route |

## What's Next

In **Step 26**, we'll add **Stream Upsert & Limit** enhancements --
update-in-place by DOM ID, bounded lists with automatic pruning,
and direction-aware limit behavior.
