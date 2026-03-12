# Step 26: Stream Upsert & Limit

[← Previous: Step 25 - LiveView Streams](25-live-streams.md) | [Next: Step 27 →](27-temporary-assigns.md)

---

## What We're Building

In Step 25 we built the stream infrastructure — insert, delete, and the
wire protocol. This step focuses on two advanced features that were
implemented alongside the core: **upsert** (update-in-place) and
**limit** (automatic pruning of bounded lists).

Both features are already present in `src/blaze/stream.ts` and the
stream demo. This tutorial explains the design decisions behind them.

## Concepts You'll Learn

- Upsert detection via server-side DOM ID tracking
- Limit pruning with direction-aware behavior
- How morphdom enables in-place updates without flicker

## Upsert: Update-in-Place

When `streamInsert()` is called with an item whose DOM ID already exists,
the server detects this and sends the same `inserts` payload. The client
uses morphdom to patch the existing element rather than appending a new one.

### Server-Side Detection

`StreamState` tracks every known DOM ID in a `Set<string>`:

```typescript
// stream.ts — streamInsert()
const domId = state.domPrefix + "-" + state.idFn(item);
const isUpdate = state.items.has(domId);

state.ops.push({ type: "insert", item, domId, at });
state.items.add(domId);

if (!isUpdate) {
  // New item: add to insertion order
  if (at === 0) state.order.unshift(domId);
  else state.order.push(domId);
  // Check limit
  if (state.limit !== null) applyLimit(state, at);
}
```

If the item already exists (`isUpdate === true`), the operation is queued
but the order array is not modified and limit pruning is skipped — the
item count hasn't changed.

### Client-Side Morphdom Patch

The client checks `document.getElementById(entry.id)` before deciding
how to apply an insert:

```javascript
// blaze.js — applyStreamOps()
var existing = document.getElementById(entry.id);
if (existing) {
  // Upsert: patch in place via morphdom
  morphdom(existing, newEl, { ... });
} else if (entry.at === 0) {
  container.insertBefore(newEl, container.firstChild);
} else {
  container.appendChild(newEl);
}
```

Morphdom diffs the old and new elements, updating only changed
attributes and text nodes. The element stays in its position in the
list, focus is preserved, and CSS transitions can animate the change.

### Demo: "Update Latest"

In `stream_demo_live.ts`, the "Update Latest" button calls
`streamInsert` with the same ID but updated text:

```typescript
handleEvent("upsert", _params, socket) {
  // Re-insert the last-added item with modified text
  socket.streamInsert("events", {
    id: lastId,
    text: "UPDATED: " + originalText,
    time: new Date().toLocaleTimeString(),
  });
}
```

The item updates in-place with no DOM reordering.

## Limit: Automatic Pruning

Streams can be bounded with a `limit` option. When the number of items
exceeds the limit, the oldest items are automatically pruned.

### Direction-Aware Pruning

The key insight: pruning should happen from the **opposite end** of where
new items are inserted. If you prepend items (at: 0), prune from the
bottom. If you append items, prune from the top.

```typescript
// stream.ts — applyLimit()
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

This mirrors Phoenix LiveView's stream limit behavior. Without
direction-awareness, prepending to a bounded list would immediately
delete the just-inserted item.

### Insertion Order Tracking

`StreamState.order` is a `string[]` that records the insertion order of
DOM IDs. This is separate from `items` (a `Set` for O(1) existence
checks). The order array is used exclusively by `applyLimit()` to
determine which items to prune.

### Wire Protocol

Limit pruning generates `delete` operations that are included alongside
the `insert` in the same message:

```json
{
  "type": "diff",
  "streams": {
    "events": {
      "inserts": [{ "id": "events-25", "html": "<div>...</div>", "at": 0 }],
      "deletes": ["events-5"]
    }
  }
}
```

The client processes inserts first, then deletes — so the list always
stays at or below the limit.

## How It Works Together

```
User clicks "Prepend Event" (21st item, limit: 20)
  ↓
handleEvent("add") → streamInsert("events", newItem, { at: 0 })
  ↓
streamInsert():
  1. domId = "events-21", isUpdate = false
  2. ops.push({ type: "insert", item, domId, at: 0 })
  3. order.unshift("events-21") → order.length = 21
  4. applyLimit(): 21 > 20, prune from end
     → ops.push({ type: "delete", domId: "events-1" })
     → order.splice(20, 1), items.delete("events-1")
  ↓
extractStreamOps() builds:
  { inserts: [{ id: "events-21", html: "...", at: 0 }],
    deletes: ["events-1"] }
  ↓
Client: insertBefore(newEl, firstChild) → removeChild(getElementById("events-1"))
```

## File Checklist

All files were created or modified as part of Step 25. This step adds
no new files — it documents the upsert and limit features.

| File | Feature | Key Lines |
|------|---------|-----------|
| `src/blaze/stream.ts` | Upsert detection | `isUpdate = state.items.has(domId)` |
| `src/blaze/stream.ts` | Limit pruning | `applyLimit()` function |
| `src/blaze/stream.ts` | Order tracking | `state.order` array |
| `public/blaze.js` | Upsert via morphdom | `existing ? morphdom(existing, newEl)` |
| `src/my_app/stream_demo_live.ts` | Demo | "Update Latest" + limit: 20 |

## What's Next

In **Step 27**, we'll add **Temporary Assigns** — assigns that reset to
a default value after each render, preventing large data from
accumulating in memory across the lifetime of a connection.
