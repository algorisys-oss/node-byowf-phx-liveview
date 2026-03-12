# Step 27: Temporary Assigns

[← Previous: Step 25 - LiveView Streams](25-live-streams.md) | [Next: Step 28 →](28-file-uploads.md)

---

## What We're Building

In a long-lived WebSocket connection, assigns can accumulate unbounded
data. A chat app that pushes every message into `assigns.messages` will
hold thousands of objects in server memory for each connected client.

**Temporary assigns** solve this by automatically resetting specified
keys to a default value after each render. The server processes the
data (renders it, streams it to the DOM), then forgets it.

Pattern: **streams** keep the data visible in the DOM, **temporary
assigns** clean it up on the server.

## Concepts You'll Learn

- Declaring temporary assigns on a LiveView subclass
- Automatic reset after `render()` in the handler lifecycle
- Pairing temporary assigns with streams for memory-efficient lists
- Distinguishing permanent state (counters) from transient state (messages)

## The Code

### 1. LiveView Base Class (`src/blaze/live_view.ts`)

Add a `temporary_assigns` property with an empty default:

```typescript
export abstract class LiveView {
  /**
   * Declare assigns that reset to a default value after each render.
   * Override in subclass: `temporary_assigns = { messages: [] }`
   */
  temporary_assigns: Record<string, unknown> = {};

  abstract mount(socket: LiveViewSocket): void | Promise<void>;
  // ...
}
```

Subclasses override it to declare which keys should reset:

```typescript
class ChatLive extends LiveView {
  temporary_assigns = { messages: [] as any[] };
  // After each render, assigns.messages resets to []
}
```

### 2. Reset Logic (`src/blaze/live_handler.ts`)

After every `sendUpdate()`, reset temporary keys:

```typescript
function resetTemporaryAssigns(view: LiveView, socket: LiveViewSocket): void {
  const temps = view.temporary_assigns;
  for (const key in temps) {
    socket.assigns[key] = temps[key];
  }
}
```

Called at the end of `sendUpdate()` — after render and diff computation,
but before the next event arrives.

### 3. Demo (`src/my_app/temp_assigns_demo_live.ts`)

```typescript
export class TempAssignsDemoLive extends LiveView {
  temporary_assigns = { messages: [] as any[] };

  mount(socket) {
    socket.assign({ messages: initial, totalSent: 2, serverHeld: 2 });
    socket.stream("msgs", initial, { render: renderMessage, limit: 50 });
  }

  handleEvent("send", params, socket) {
    const msg = { id: nextId++, text: "...", time: "..." };
    socket.assign({ messages: [msg], totalSent: total + 1, serverHeld: 1 });
    socket.streamInsert("msgs", msg, { at: 0 });
    // After render: messages resets to [], serverHeld stays at 1
    // (serverHeld is NOT temporary — it shows the last batch size)
  }
}
```

Three metrics demonstrate the behavior:
- **Total Sent** — permanent assign, always increasing
- **Server Held** — shows batch size during render
- **Current Batch** — shows `messages.length` (resets to 0 after render)

## How It Works

```
handleEvent("send") → socket.assign({ messages: [newMsg] })
  ↓
sendUpdate() → view.render(assigns)
  ↓
render() reads assigns.messages (has 1 message) → builds diff
  ↓
extractStreamOps() → builds insert payload for the new message
  ↓
ws.send(diff + streams) → client receives and patches DOM
  ↓
resetTemporaryAssigns(view, socket)
  ↓
assigns.messages = []  ← reset to default
  ↓
Next event: assigns.messages is [] — server holds no message history
But the DOM still shows all messages (managed by streams)
```

## Try It Out

```bash
npx tsx src/app.ts
# Visit http://localhost:4001/temp-assigns
```

- Click "Send Message" — watch "Current Batch" flash 1 then show 0
- Click "Send 10 Messages" — batch shows 10 then drops to 0
- "Total Sent" keeps growing (permanent assign)
- The message list in the DOM keeps growing (managed by streams)
- The server forgets messages after each render (temporary assign)

## File Checklist

| File | Action | Purpose |
|------|--------|---------|
| `src/blaze/live_view.ts` | Modified | Added `temporary_assigns` property to LiveView |
| `src/blaze/live_handler.ts` | Modified | Added `resetTemporaryAssigns()`, called after sendUpdate |
| `src/my_app/temp_assigns_demo_live.ts` | **New** | Demo with permanent + temporary assigns + streams |
| `src/app.ts` | Modified | Added /temp-assigns route |

## What's Next

In **Step 28**, we'll add **File Uploads** — multipart POST handling
and chunked WebSocket uploads with progress tracking.
