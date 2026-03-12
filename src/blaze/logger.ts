/**
 * Blaze Logger -- Structured request logging with per-request ID.
 *
 * Assigns a unique request ID to each request, stores it via AsyncLocalStorage,
 * and logs method, path, status, and duration with color-coded output.
 * The request ID is also set as the x-request-id response header.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "./context.js";

/** AsyncLocalStorage for per-request context (request ID, etc.) */
export const requestStorage = new AsyncLocalStorage<{ requestId: string }>();

/** Generate a short unique request ID. */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Get the current request ID from AsyncLocalStorage (if available). */
export function getRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

/** Color code for HTTP status. */
function statusColor(status: number): string {
  if (status >= 500) return "\x1b[31m"; // red
  if (status >= 400) return "\x1b[33m"; // yellow
  if (status >= 300) return "\x1b[36m"; // cyan
  if (status >= 200) return "\x1b[32m"; // green
  return "\x1b[0m";
}

/** Color code for HTTP method. */
function methodColor(method: string): string {
  switch (method) {
    case "GET": return "\x1b[36m";    // cyan
    case "POST": return "\x1b[33m";   // yellow
    case "PUT": return "\x1b[34m";    // blue
    case "PATCH": return "\x1b[35m";  // magenta
    case "DELETE": return "\x1b[31m"; // red
    default: return "\x1b[0m";
  }
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

/**
 * Logger middleware: assigns request ID and start time.
 * Should be the first middleware in the pipeline.
 */
export function loggerMiddleware(ctx: Context): Context {
  const requestId = generateRequestId();
  ctx.putPrivate("requestId", requestId);
  ctx.putPrivate("startTime", performance.now());
  ctx.setHeader("x-request-id", requestId);
  return ctx;
}

/**
 * Log a completed request. Call after the response is ready.
 */
export function logRequest(ctx: Context): void {
  const requestId = (ctx.getPrivate("requestId") as string) ?? "--------";
  const startTime = ctx.getPrivate("startTime") as number | undefined;
  const duration = startTime ? (performance.now() - startTime).toFixed(1) : "?";
  const method = ctx.method;
  const path = ctx.path;
  const status = ctx.status;

  console.log(
    `${DIM}[${requestId}]${RESET} ` +
    `${methodColor(method)}${method.padEnd(7)}${RESET} ` +
    `${path} ` +
    `${statusColor(status)}${status}${RESET} ` +
    `${DIM}${duration}ms${RESET}`,
  );
}
