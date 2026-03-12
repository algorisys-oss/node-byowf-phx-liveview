[← Step 38: Test Helpers](38-test-helpers.md) | [Step 40: SSL/TLS Support →](40-ssl-tls-support.md)

# Step 39 — Health Check

## What We're Building

A `/health` endpoint that returns JSON with server status: uptime, memory usage, active WebSocket connections, and Node.js version. Used by load balancers, monitoring systems, and deployment tools to verify the server is healthy.

## Concepts You'll Learn

- **Health checks** — standard pattern for monitoring and load balancer probes
- **process.memoryUsage()** — RSS, heap, and external memory tracking
- **process.uptime()** — seconds since process start
- **Connection tracking** — incrementing/decrementing a counter on WS open/close

## How It Works

### Health Check Response

```json
{
  "status": "ok",
  "uptime": "1h 23m 45s",
  "uptime_seconds": 5025,
  "memory": {
    "rss": "93.4 MB",
    "heapUsed": "8.5 MB",
    "heapTotal": "12.8 MB",
    "external": "2.4 MB"
  },
  "connections": 3,
  "node_version": "v22.14.0",
  "platform": "linux"
}
```

### Connection Tracking

The `health.ts` module exports `incrementConnections()` and `decrementConnections()` which are called from `live_handler.ts` on WebSocket open/close events:

```
WS open  → incrementConnections() → connections: 1
WS open  → incrementConnections() → connections: 2
WS close → decrementConnections() → connections: 1
```

## The Code

### `src/blaze/health.ts` (new)

```typescript
import type { Context } from "./context.js";

/** Track active WebSocket connections (incremented/decremented by live_handler) */
let wsConnectionCount = 0;

export function incrementConnections(): void {
  wsConnectionCount++;
}

export function decrementConnections(): void {
  wsConnectionCount = Math.max(0, wsConnectionCount - 1);
}

export function getConnectionCount(): number {
  return wsConnectionCount;
}

/** Format bytes to human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format seconds to human-readable duration. */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/** Health check handler. Returns JSON with server status. */
export function healthCheck(ctx: Context): Context {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  const data = {
    status: "ok",
    uptime: formatUptime(uptime),
    uptime_seconds: Math.floor(uptime),
    memory: {
      rss: formatBytes(mem.rss),
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      external: formatBytes(mem.external),
    },
    connections: wsConnectionCount,
    node_version: process.version,
    platform: process.platform,
  };

  return ctx
    .setStatus(200)
    .setHeader("content-type", "application/json")
    .setHeader("cache-control", "no-cache")
    .setBody(JSON.stringify(data, null, 2))
    .halt();
}
```

### Changes to `src/blaze/live_handler.ts`

Added `incrementConnections()` in `handleOpen()` and `decrementConnections()` in `handleClose()`.

### Changes to `src/app.ts`

Added `/health` route and landing page link.

## Try It Out

```bash
npm run dev
```

1. Check health:
   ```bash
   curl -s http://localhost:4001/health | jq .
   ```
2. Open a LiveView page (e.g., `/counter`) in the browser, then check health again — `connections` should be 1
3. Open another tab — `connections` becomes 2
4. Close a tab — `connections` decreases

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/health.ts` | **New** | Health check handler + connection counter |
| `src/blaze/live_handler.ts` | Modified | Track WS connections open/close |
| `src/app.ts` | Modified | Added `/health` route + landing page link |

## What's Next

**Step 40 — SSL/TLS Support:** uWS `SSLApp()` for HTTPS, config-driven certificates.

[← Step 38: Test Helpers](38-test-helpers.md) | [Step 40: SSL/TLS Support →](40-ssl-tls-support.md)
