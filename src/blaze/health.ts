/**
 * Blaze Health Check -- /health endpoint for monitoring.
 *
 * Reports server uptime, memory usage, Node.js version,
 * and active WebSocket connection count.
 */

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
