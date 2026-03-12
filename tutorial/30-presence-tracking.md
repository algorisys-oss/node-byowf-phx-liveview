# Step 30 — Presence Tracking

## What We're Building

A real-time "Who's Online" system. Each connected tab gets a random username and color dot. Open multiple tabs and watch users appear; close a tab and watch them disappear — instantly, across all connected clients.

This is equivalent to `Phoenix.Presence`, but simplified for single-node deployment.

## Concepts You'll Learn

- **Presence tracking** — in-memory Map of topic → users with metadata
- **Auto-cleanup on disconnect** — reverse index from subscriber → tracked entries
- **Presence diffs** — broadcasting joins and leaves as structured messages
- **PubSub integration** — presence changes flow through the existing PubSub system

## The Code

### 1. Presence Module (`src/blaze/presence.ts`)

The presence module manages two data structures:

```typescript
// Primary state: topic → (key → meta)
const presences = new Map<string, Map<string, PresenceMeta>>();

// Reverse index: subscriber → [{topic, key}] for auto-cleanup
const subscriberKeys = new Map<PubSub.Subscriber, Array<{ topic: string; key: string }>>();
```

**Track** registers a user in a topic and broadcasts a join diff:

```typescript
export function track(topic: string, key: string, meta: PresenceMeta, subscriber?: PubSub.Subscriber): void {
  // Store in presences map
  topicMap.set(key, meta);

  // Store reverse reference for auto-cleanup
  if (subscriber) subscriberKeys.get(subscriber)!.push({ topic, key });

  // Broadcast join
  PubSub.broadcast(topic, { type: "presence_diff", diff: { joins: { [key]: meta }, leaves: {} } });
}
```

**Untrack** removes a user and broadcasts a leave diff:

```typescript
export function untrack(topic: string, key: string): void {
  const meta = topicMap.get(key);
  topicMap.delete(key);
  PubSub.broadcast(topic, { type: "presence_diff", diff: { joins: {}, leaves: { [key]: meta } } });
}
```

**UntrackAll** — the auto-cleanup function, called when a WebSocket closes:

```typescript
export function untrackAll(subscriber: PubSub.Subscriber): void {
  const entries = subscriberKeys.get(subscriber);
  for (const { topic, key } of entries) untrack(topic, key);
  subscriberKeys.delete(subscriber);
}
```

### 2. LiveViewSocket Extensions

Two new methods on the socket interface:

```typescript
// In LiveViewSocket interface:
trackPresence(topic: string, key: string, meta: PresenceMeta): void;
listPresences(topic: string): Record<string, PresenceMeta>;
```

`trackPresence` passes the PubSub subscriber reference to `Presence.track()`, enabling auto-cleanup when the connection drops.

### 3. LiveHandler Integration

In `handleClose()`, presence cleanup happens **before** PubSub unsubscribe:

```typescript
export function handleClose(ws: WebSocket<LiveConnection>): void {
  if (data.subscriber) {
    Presence.untrackAll(data.subscriber);  // ← broadcasts leave diffs
  }
  if (data.subscriber) {
    PubSub.unsubscribeAll(data.subscriber);  // ← then clean up PubSub
  }
}
```

Order matters: `untrackAll` broadcasts leave diffs via PubSub, so PubSub subscriptions must still be active at that point.

### 4. Demo LiveView (`src/my_app/presence_demo_live.ts`)

```typescript
mount(socket: LiveViewSocket): void {
  const name = randomPick(NAMES);
  const color = randomPick(COLORS);
  const id = `${name}-${Math.random().toString(36).slice(2, 6)}`;

  socket.subscribe(TOPIC);                              // Listen for diffs
  socket.trackPresence(TOPIC, id, { name, color, ... }); // Register self

  socket.assign({
    myId: id, myName: name, myColor: color,
    users: socket.listPresences(TOPIC),                  // Initial user list
  });
}

handleInfo(message: unknown, socket: LiveViewSocket): void {
  if (msg.type === "presence_diff") {
    socket.assign({ users: socket.listPresences(TOPIC) }); // Refresh on any change
  }
}
```

## How It Works

```
Tab A opens /presence
  ├─ subscribe("presence:lobby")
  ├─ trackPresence("presence:lobby", "Blaze-a1b2", { name: "Blaze", color: "#3498db" })
  │    → Presence.track() stores entry + broadcasts join diff
  └─ render: shows 1 user (self)

Tab B opens /presence
  ├─ subscribe + trackPresence("presence:lobby", "Nova-c3d4", { ... })
  │    → broadcasts join diff → Tab A receives via handleInfo
  ├─ Tab A re-renders: shows 2 users
  └─ Tab B renders: shows 2 users

Tab B closes
  ├─ handleClose() → Presence.untrackAll(subscriber)
  │    → untrack("presence:lobby", "Nova-c3d4")
  │    → broadcasts leave diff → Tab A receives
  ├─ PubSub.unsubscribeAll() cleans up subscriptions
  └─ Tab A re-renders: shows 1 user
```

## Elixir vs Node.js: Auto-Cleanup

| Aspect | Elixir (Ignite) | Node.js (Blaze) |
|---|---|---|
| Monitoring | `Process.monitor(pid)` → `:DOWN` message | Reverse index: subscriber → entries |
| Trigger | Process death (automatic) | `handleClose()` callback (explicit) |
| Cleanup | GenServer handles `:DOWN` | `Presence.untrackAll(subscriber)` |
| Result | Same: leave diff broadcast to all | Same: leave diff broadcast to all |

Elixir's BEAM detects process death automatically. In Node.js, we achieve the same result by tracking the PubSub subscriber reference and cleaning up in the WebSocket close handler.

## Try It Out

```bash
npx tsx src/app.ts
```

1. Open http://localhost:4001/presence in a browser tab
2. Note your randomly assigned name and color
3. Open the same URL in 2-3 more tabs
4. Watch the user list grow in real time
5. Close a tab — the user disappears from all other tabs instantly

## File Checklist

| File | Status | Purpose |
|---|---|---|
| `src/blaze/presence.ts` | **New** | Presence tracking with auto-cleanup |
| `src/blaze/live_view.ts` | Modified | Added `trackPresence`, `listPresences` to socket interface |
| `src/blaze/live_handler.ts` | Modified | Wired presence methods + cleanup in handleClose |
| `src/my_app/presence_demo_live.ts` | **New** | "Who's Online" demo |
| `src/app.ts` | Modified | Added `/presence` route |

## What's Next

**Step 31 — SQLite Integration:** A database layer using `better-sqlite3` — schema definition, migrations, and query helpers for persisting data beyond in-memory state.
