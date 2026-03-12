[← Step 41: Rate Limiting](41-rate-limiting.md) | [Step 43: Single Executable →](43-single-executable.md)

# Step 42 — Cluster Mode

## What We're Building

Multi-core scaling using `node:cluster`. The primary process forks one worker per CPU core, each running a full Blaze server. PubSub broadcasts are relayed across workers via IPC, so LiveView updates work across all cores.

## Concepts You'll Learn

- **node:cluster** — forking worker processes for multi-core scaling
- **SO_REUSEPORT** — OS-level port sharing across processes (uWS handles this)
- **IPC (Inter-Process Communication)** — `process.send()` / `process.on("message")` between primary and workers
- **Cross-worker PubSub** — relaying broadcasts so all workers receive LiveView updates

## How It Works

### Architecture

```
             ┌──────────────┐
             │   Primary    │ (no HTTP server)
             │   Process    │
             └──┬───┬───┬──┘
                │   │   │     IPC messages
         ┌──────┘   │   └──────┐
         ▼          ▼          ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │Worker 1 │ │Worker 2 │ │Worker 3 │  ... (1 per CPU core)
    │ :4001   │ │ :4001   │ │ :4001   │
    │  uWS    │ │  uWS    │ │  uWS    │
    └─────────┘ └─────────┘ └─────────┘
         ↑          ↑          ↑
         └──────────┴──────────┘
              OS load balances
              incoming connections
```

### PubSub Relay

When Worker 1 broadcasts a PubSub message:
1. Worker 1's `onBroadcast` hook sends IPC message to Primary
2. Primary relays to Workers 2, 3, etc. (all workers except the sender)
3. Each worker calls `publishLocal()` to deliver to local subscribers
4. Worker 1's local subscribers already received the message directly

```
Worker 1: broadcast("counter:lobby", { count: 5 })
  → local subscribers notified
  → IPC → Primary → IPC → Worker 2, 3
  → Worker 2: publishLocal("counter:lobby", { count: 5 })
  → Worker 3: publishLocal("counter:lobby", { count: 5 })
```

### Worker Auto-Restart

If a worker crashes, the primary automatically forks a replacement and sets up IPC on the new worker:

```typescript
cluster.on("exit", (worker, code, signal) => {
  console.log(`Worker ${worker.process.pid} died (${signal || code}), restarting...`);
  const newWorker = cluster.fork();
  // Set up IPC relay on the new worker too
});
```

## The Code

### Changes to `src/blaze/pub_sub.ts`

Before creating the cluster module, we need two additions to PubSub:

1. **`publishLocal()`** — delivers to local subscribers without triggering the cluster hook (prevents infinite relay loops).
2. **`onBroadcast()`** — registers a hook that fires on every `broadcast()`, used by cluster workers to relay messages via IPC.

Here is the full `src/blaze/pub_sub.ts`:

```typescript
/**
 * Blaze PubSub -- In-process topic-based publish/subscribe.
 *
 * Equivalent to Ignite.PubSub in the Elixir version.
 * Elixir uses Erlang :pg (process groups) for automatic cleanup.
 * We use a simple Map<topic, Set<callback>> with manual unsubscribe.
 *
 * Broadcasts exclude the sender -- the sender updates its own state
 * in handleEvent, while other subscribers receive via handleInfo.
 */

export type Subscriber = (message: unknown) => void;
export type BroadcastHook = (topic: string, message: unknown) => void;

const topics = new Map<string, Set<Subscriber>>();
let broadcastHook: BroadcastHook | null = null;

/** Subscribe a callback to a topic. */
export function subscribe(topic: string, callback: Subscriber): void {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic)!.add(callback);
}

/** Unsubscribe a callback from a topic. */
export function unsubscribe(topic: string, callback: Subscriber): void {
  const subs = topics.get(topic);
  if (subs) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

/** Unsubscribe a callback from all topics. */
export function unsubscribeAll(callback: Subscriber): void {
  for (const [topic, subs] of topics) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

/** Broadcast a message to all subscribers of a topic, excluding the sender. */
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
  // Notify cluster hook for cross-worker relay
  if (broadcastHook) broadcastHook(topic, message);
}

/**
 * Publish a message locally without triggering the cluster hook.
 * Used by cluster workers receiving relayed messages from other workers.
 */
export function publishLocal(topic: string, message: unknown): void {
  const subs = topics.get(topic);
  if (!subs) return;
  for (const cb of subs) {
    cb(message);
  }
}

/**
 * Register a hook called on every broadcast (for cluster IPC relay).
 */
export function onBroadcast(hook: BroadcastHook): void {
  broadcastHook = hook;
}
```

The two new functions added for cluster support are:

- **`publishLocal()`** — identical to `broadcast()` but skips the `broadcastHook` and has no `exclude` parameter. When a worker receives a relayed message from another worker via IPC, it calls `publishLocal()` to deliver to its own local subscribers without re-triggering the relay (which would cause an infinite loop).
- **`onBroadcast()`** — stores a single hook function. The cluster module calls this to register a function that sends IPC messages to the primary process whenever a local `broadcast()` occurs.

### `src/blaze/cluster.ts` (new)

```typescript
/**
 * Blaze Cluster -- Multi-core scaling with node:cluster.
 *
 * The primary process forks one worker per CPU core.
 * Each worker runs a full Blaze server (uWS handles port sharing via SO_REUSEPORT).
 * IPC messages relay PubSub broadcasts across workers for cross-process LiveView updates.
 */

import cluster from "node:cluster";
import { cpus } from "node:os";
import * as PubSub from "./pub_sub.js";

export interface ClusterOptions {
  /** Number of workers (default: number of CPU cores) */
  workers?: number;
}

/** IPC message format for cross-worker PubSub */
interface IPCMessage {
  type: "pubsub_broadcast";
  topic: string;
  message: unknown;
  fromWorker: number;
}

/**
 * Start the cluster: primary forks workers, workers call the callback.
 * Returns true if this is the primary (caller should NOT start server).
 * Returns false if this is a worker (caller SHOULD start server).
 */
export function startCluster(options: ClusterOptions = {}): boolean {
  const numWorkers = options.workers ?? cpus().length;

  if (cluster.isPrimary) {
    console.log(`[cluster] Primary ${process.pid} starting ${numWorkers} workers`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = cluster.fork();
      worker.on("message", (msg: IPCMessage) => {
        if (msg.type === "pubsub_broadcast") {
          // Relay to all OTHER workers
          for (const [id, w] of Object.entries(cluster.workers ?? {})) {
            if (w && w.id !== msg.fromWorker) {
              w.send(msg);
            }
          }
        }
      });
    }

    cluster.on("exit", (worker, code, signal) => {
      console.log(`[cluster] Worker ${worker.process.pid} died (${signal || code}), restarting...`);
      const newWorker = cluster.fork();
      newWorker.on("message", (msg: IPCMessage) => {
        if (msg.type === "pubsub_broadcast") {
          for (const [id, w] of Object.entries(cluster.workers ?? {})) {
            if (w && w.id !== msg.fromWorker) {
              w.send(msg);
            }
          }
        }
      });
    });

    return true; // This is primary — don't start server
  }

  // Worker process: set up IPC PubSub relay
  setupWorkerIPC();

  console.log(`[cluster] Worker ${process.pid} started`);
  return false; // This is a worker — start server
}

/**
 * Set up IPC message handling for PubSub relay in worker processes.
 * When a worker publishes to PubSub, relay to primary which fans out.
 * When receiving from primary, publish locally.
 */
function setupWorkerIPC(): void {
  // Hook into PubSub to broadcast across workers
  PubSub.onBroadcast((topic: string, message: unknown) => {
    if (process.send) {
      const msg: IPCMessage = {
        type: "pubsub_broadcast",
        topic,
        message,
        fromWorker: cluster.worker?.id ?? 0,
      };
      process.send(msg);
    }
  });

  // Receive broadcasts from other workers (via primary relay)
  process.on("message", (msg: IPCMessage) => {
    if (msg.type === "pubsub_broadcast") {
      PubSub.publishLocal(msg.topic, msg.message);
    }
  });
}
```

Key details:

- **`startCluster()`** returns a boolean: `true` for the primary (which should not start a server), `false` for workers (which should). This keeps the calling code simple.
- **Primary process** forks `numWorkers` workers and sets up an IPC message listener on each. When a worker sends a `pubsub_broadcast` message, the primary relays it to all other workers (excluding the sender via `fromWorker`).
- **Worker auto-restart** — the `cluster.on("exit")` handler forks a replacement worker and re-attaches the IPC listener. This provides basic fault tolerance.
- **`setupWorkerIPC()`** does two things:
  1. Registers a `PubSub.onBroadcast()` hook that sends IPC messages to the primary whenever a local broadcast occurs.
  2. Listens for incoming IPC messages from the primary and calls `PubSub.publishLocal()` to deliver them to local subscribers without re-triggering the relay.
- **`process.send` guard** — in worker processes, `process.send` exists because IPC is set up by `cluster.fork()`. The guard is a TypeScript safety check.

### `src/cluster.ts` (new entry point)

This is the entry point for cluster mode. It calls `startCluster()` and, if this is a worker, starts the server:

```typescript
/**
 * Cluster entry point -- starts Blaze with one worker per CPU core.
 *
 * Usage: npx tsx src/cluster.ts
 * Or:    npm run cluster
 */

import { startCluster } from "./blaze/cluster.js";
import { serve } from "./blaze/server.js";
import { router, liveRoutes } from "./app.js";

const isPrimary = startCluster();

if (!isPrimary) {
  // Worker: start the server
  const ssl = process.env.SSL_KEY && process.env.SSL_CERT
    ? { keyFile: process.env.SSL_KEY, certFile: process.env.SSL_CERT }
    : undefined;
  serve({ port: 4001, router, liveRoutes, ssl });
}
```

Note that `src/app.ts` exports `router` and `liveRoutes` but only starts the server when it detects it is the main entry point (`process.argv[1]` ends with `app.ts`). When imported from `src/cluster.ts`, the app module provides the router and routes without starting its own server.

### `package.json` script

Add the `cluster` script:

```json
{
  "scripts": {
    "start": "npx tsx src/app.ts",
    "cluster": "npx tsx src/cluster.ts"
  }
}
```

## Try It Out

```bash
# Single process (default)
npm start

# Cluster mode (1 worker per CPU core)
npm run cluster
```

Output:
```
[cluster] Primary 12345 starting 8 workers
[cluster] Worker 12346 started
[cluster] Worker 12347 started
...
Blaze is heating up on http://localhost:4001
Blaze is heating up on http://localhost:4001
...
```

Test cross-worker PubSub:
1. Open `/shared-counter` in two browser tabs
2. Click increment in one tab
3. The counter updates in both tabs (even if served by different workers)

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/cluster.ts` | **New** | Cluster management, IPC PubSub relay |
| `src/blaze/pub_sub.ts` | Modified | Added `publishLocal()`, `onBroadcast()` |
| `src/cluster.ts` | **New** | Cluster entry point |
| `package.json` | Modified | Added `cluster` npm script |

## What's Next

**Step 43 — Single Executable:** Package Blaze as a standalone binary using Node.js Single Executable Applications (SEA).

[← Step 41: Rate Limiting](41-rate-limiting.md) | [Step 43: Single Executable →](43-single-executable.md)
