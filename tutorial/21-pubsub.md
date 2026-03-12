# Step 21: PubSub

[← Previous: Step 20 - Hot Code Reloader](20-hot-code-reloader.md) | [Next: Step 22 - LiveView Navigation →](22-liveview-navigation.md)

---

## What We're Building

So far, each LiveView connection is isolated -- clicking a button in one
tab only affects that tab. Real apps need real-time sync: chat rooms,
collaborative editors, live dashboards, notifications.

In this step, we add **PubSub** -- a topic-based publish/subscribe system
that lets LiveView instances broadcast messages to each other:

1. `pub_sub.ts` -- an in-process pub/sub engine
2. `socket.subscribe(topic)` -- subscribe a LiveView to a topic
3. `socket.broadcast(topic, message)` -- send to all other subscribers
4. `handleInfo(message, socket)` -- receive broadcasts and update state
5. A **shared counter** that syncs across all connected tabs

### How This Compares to Ignite (Elixir)

In Ignite, PubSub uses Erlang's `:pg` (process groups). Each LiveView is
an Erlang process; `broadcast/2` sends a message to every subscribed
process's mailbox via `send/2`. The WebSocket handler dispatches incoming
mailbox messages to `handle_info/2` via the `websocket_info` callback.
When a process dies, `:pg` automatically removes it from all groups.

In Blaze, we use a simple in-process `Map<topic, Set<callback>>`. Each
LiveView connection registers a callback that invokes `handleInfo()`,
re-renders, and sends the diff. On disconnect, `unsubscribeAll()` cleans
up. Different mechanism, same developer experience.

## Concepts You'll Learn

### The Broadcast Flow

```
Tab A clicks "+"
       |
handleEvent("increment", socket)
  → socket.assign({ count: 1 })
  → socket.broadcast("counter:lobby", { count_updated: 1 })
  → re-render → send diff to Tab A
       |
PubSub delivers message to Tab B's subscriber callback
       |
handleInfo({ count_updated: 1 }, socket)
  → socket.assign({ count: 1 })
  → re-render → send diff to Tab B
       |
Both tabs now show count: 1
```

### Why Not uWS Native WebSocket Pub/Sub?

uWebSockets.js has built-in `ws.subscribe(topic)` / `ws.publish(topic, data)`.
These send raw data directly to subscribed WebSocket **clients** (browsers).
But LiveView needs the **server** to process broadcasts first -- updating
assigns, re-rendering, computing diffs. So we use our own in-process
pub/sub where callbacks run server-side code.

| Approach | uWS Native | Blaze PubSub |
|---|---|---|
| Receiver | Client (browser) | Server (LiveView) |
| Processing | None (raw relay) | handleInfo → re-render → diff |
| Use case | Chat, raw messaging | LiveView state sync |

### Sender Exclusion

The sender is excluded from broadcasts. This prevents double-updates:

```typescript
// In handleEvent:
socket.assign({ count: 1 });              // Sender updates itself
socket.broadcast(TOPIC, { count: 1 });     // Others get the message
// → sender re-renders from assign()
// → others re-render from handleInfo()
```

If we didn't exclude the sender, it would process the broadcast too,
potentially overwriting state that was already set.

### Automatic Cleanup

When a WebSocket connection closes, `unsubscribeAll()` removes its
callback from every topic. No dangling references, no memory leaks.
This mirrors Erlang's `:pg` automatic cleanup on process death.

### Comparison: Elixir vs Node.js

| Concept | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| Engine | Erlang `:pg` (process groups) | `Map<topic, Set<callback>>` |
| Subscribe | `:pg.join(scope, topic, self())` | `PubSub.subscribe(topic, cb)` |
| Broadcast | `send/2` to each PID | Invoke each callback |
| Exclude sender | `pid != self()` filter | `cb !== exclude` filter |
| Cleanup | Automatic on process death | `unsubscribeAll()` on WS close |
| Receive | `websocket_info` → `handle_info/2` | Callback → `handleInfo()` |
| Distribution | Works across nodes (`:pg` is distributed) | Single process only |

## The Code

### `src/blaze/pub_sub.ts` -- Topic-Based Pub/Sub

```typescript
export type Subscriber = (message: unknown) => void;

const topics = new Map<string, Set<Subscriber>>();

export function subscribe(topic: string, callback: Subscriber): void {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic)!.add(callback);
}

export function unsubscribe(topic: string, callback: Subscriber): void {
  const subs = topics.get(topic);
  if (subs) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

export function unsubscribeAll(callback: Subscriber): void {
  for (const [topic, subs] of topics) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

export function broadcast(
  topic: string,
  message: unknown,
  exclude?: Subscriber,
): void {
  const subs = topics.get(topic);
  if (!subs) return;
  for (const cb of subs) {
    if (cb !== exclude) cb(message);
  }
}
```

**Key decisions:**

- **Callback-based:** Each subscriber is a function, not a process or
  WebSocket. This lets us run server-side logic (handleInfo) on receive.
- **Sender exclusion via identity:** `cb !== exclude` uses reference
  equality. Each connection gets its own callback closure, so this works.
- **Empty topic cleanup:** When the last subscriber leaves a topic,
  the topic is deleted from the map. No leaking empty Sets.

### `src/blaze/live_view.ts` -- New Socket Methods + handleInfo

```typescript
export interface LiveViewSocket {
  assigns: Record<string, unknown>;
  assign(newAssigns: Record<string, unknown>): void;
  subscribe(topic: string): void;
  broadcast(topic: string, message: unknown): void;
}

export abstract class LiveView {
  // ...existing methods...

  /** Called when a PubSub broadcast is received. Optional. */
  handleInfo?(
    message: unknown,
    socket: LiveViewSocket,
  ): void | Promise<void>;
}
```

### `src/blaze/live_handler.ts` -- Wiring PubSub to LiveView

```typescript
// Each connection creates a subscriber callback
const subscriber: PubSub.Subscriber = async (message: unknown) => {
  if (view.handleInfo) {
    const infoResult = view.handleInfo(message, socket);
    if (infoResult instanceof Promise) await infoResult;
    sendUpdate(ws, data);
  }
};

const socket = createSocket(subscriber);
```

The `sendUpdate()` helper extracts the re-render + diff logic into a
reusable function used by both `handleMessage` (handleEvent) and the
subscriber callback (handleInfo).

On close, subscriptions are cleaned up:

```typescript
export function handleClose(ws) {
  const data = ws.getUserData();
  if (data.subscriber) PubSub.unsubscribeAll(data.subscriber);
  // ...cleanup...
}
```

### `src/my_app/shared_counter_live.ts` -- Shared Counter Demo

```typescript
const TOPIC = "shared_counter:lobby";

export class SharedCounterLive extends LiveView {
  mount(socket: LiveViewSocket) {
    socket.assign({ count: 0 });
    socket.subscribe(TOPIC);
  }

  handleEvent(event, _params, socket) {
    const count = socket.assigns.count as number;
    switch (event) {
      case "increment":
        socket.assign({ count: count + 1 });
        socket.broadcast(TOPIC, { count_updated: count + 1 });
        break;
      // ...decrement, reset...
    }
  }

  handleInfo(message, socket) {
    const msg = message as { count_updated?: number };
    if (msg.count_updated !== undefined) {
      socket.assign({ count: msg.count_updated });
    }
  }

  render(assigns) {
    return bv`
      <h1>Shared Counter</h1>
      <p>All connected tabs share this count: <strong>${assigns.count}</strong></p>
      <button bv-click="increment">+</button>
    `;
  }
}
```

**Pattern:** subscribe in `mount`, broadcast in `handleEvent`, receive in
`handleInfo`. The sender updates its own state with `assign()` and
broadcasts to others. Recipients update via `handleInfo`.

## How It Works

```
1. Tab A connects to /shared-counter
   → mount: subscribe("shared_counter:lobby"), count = 0
   → send mount message with statics + dynamics

2. Tab B connects to /shared-counter
   → mount: subscribe("shared_counter:lobby"), count = 0
   → send mount message with statics + dynamics

3. Tab A clicks "+"
   → handleEvent: count = 1, broadcast({ count_updated: 1 })
   → re-render Tab A → diff → send { type: "diff", dynamics: {"0": "1"} }
   → PubSub invokes Tab B's subscriber callback
   → handleInfo: count = 1
   → re-render Tab B → diff → send { type: "diff", dynamics: {"0": "1"} }

4. Both tabs now show count: 1

5. Tab A disconnects
   → unsubscribeAll removes Tab A from "shared_counter:lobby"
   → Tab B is unaffected
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Open two tabs

Open http://localhost:4001/shared-counter in two browser tabs (or two
different browsers).

### 3. Click in one tab

Click "+" in Tab A. Watch Tab B update instantly. Click "-" in Tab B.
Watch Tab A update. Both tabs always show the same count.

### 4. Watch the WebSocket traffic

Open DevTools → Network → WS in both tabs. When Tab A clicks "+":

**Tab A (sender):**
```json
→ { "type": "event", "event": "increment" }
← { "type": "diff", "dynamics": {"0": "1"} }
```

**Tab B (receiver via PubSub):**
```json
← { "type": "diff", "dynamics": {"0": "1"} }
```

Tab B receives a diff without sending any event -- it was pushed by the
server via PubSub.

### 5. Close one tab

Close Tab A. Tab B continues to work. Click "+" in Tab B -- no errors,
no stale subscribers.

### 6. Test other LiveViews

Visit /counter -- it still works independently per tab (no PubSub).
Visit /dashboard -- also independent.

### 7. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/pub_sub.ts` | **New** | In-process topic-based pub/sub engine |
| `src/blaze/live_view.ts` | **Modified** | `subscribe()`, `broadcast()` on socket; `handleInfo()` |
| `src/blaze/live_handler.ts` | **Modified** | PubSub subscriber wiring, `sendUpdate()` helper, cleanup |
| `src/my_app/shared_counter_live.ts` | **New** | Shared counter demo with cross-tab sync |
| `src/app.ts` | **Modified** | Register `/shared-counter` route, landing page link |

---

[← Previous: Step 20 - Hot Code Reloader](20-hot-code-reloader.md) | [Next: Step 22 - LiveView Navigation →](22-liveview-navigation.md)

## What's Next

In **Step 22**, we'll add **LiveView Navigation** -- SPA-like client-side
navigation between LiveViews using `bv-navigate`, `history.pushState`,
and WebSocket reconnection, without full page reloads.
