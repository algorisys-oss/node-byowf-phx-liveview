/**
 * Blaze Test Helpers -- Test utilities for route handlers.
 *
 * Equivalent to Ignite.ConnTest in the Elixir version.
 * Provides buildContext(), HTTP method helpers (get/post/put/patch/del),
 * and response assertion helpers — all without starting a real server.
 */

import { strict as assert } from "node:assert";
import { Context } from "./context.js";
import type { Router } from "./router.js";
import { generateToken, maskToken } from "./csrf.js";

/**
 * Build a test Context without a real HTTP server.
 * The sendFn captures the response for later assertion.
 */
export function buildContext(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: string;
  } = {},
): Context {
  const headers = options.headers ?? {};
  const query = options.query ?? "";

  // No-op sendFn — tests read ctx state directly
  const ctx = new Context({
    method: method.toUpperCase(),
    path,
    query,
    headers,
    rawBody: "",
    sendFn: () => {},
  });

  if (options.body) {
    ctx.body = options.body;
  }

  return ctx;
}

/**
 * Initialize a test session with a CSRF token.
 * Required for testing POST/PUT/PATCH/DELETE routes that use CSRF protection.
 */
export function initTestSession(ctx: Context, extra: Record<string, unknown> = {}): Context {
  const token = generateToken();
  ctx.session = { _csrf_token: token, ...extra };
  // Store flash as empty (simulates session middleware)
  ctx.putPrivate("flash", {});
  return ctx;
}

/**
 * Add a masked CSRF token to the request body.
 * Must call initTestSession() first to set up the session token.
 */
export function withCsrf(ctx: Context): Context {
  const sessionToken = ctx.session._csrf_token as string;
  if (!sessionToken) {
    throw new Error("Call initTestSession(ctx) before withCsrf(ctx)");
  }
  ctx.body._csrf_token = maskToken(sessionToken);
  return ctx;
}

// -- HTTP method helpers: dispatch through the full router pipeline --

export async function get(router: Router, path: string, options?: { headers?: Record<string, string>; query?: string }): Promise<Context> {
  const ctx = buildContext("GET", path, options);
  return router.call(ctx);
}

export async function post(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("POST", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function put(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("PUT", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function patch(router: Router, path: string, body?: Record<string, unknown>, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("PATCH", path, { body, ...options });
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

export async function del(router: Router, path: string, options?: { headers?: Record<string, string> }): Promise<Context> {
  const ctx = buildContext("DELETE", path, options);
  initTestSession(ctx);
  withCsrf(ctx);
  return router.call(ctx);
}

// -- Response assertion helpers --

/**
 * Assert status code and return the response body as text.
 */
export function textResponse(ctx: Context, expectedStatus: number): string {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  return (ctx as unknown as { _respBody: string })._respBody;
}

/**
 * Assert status code and HTML content-type, return the body.
 */
export function htmlResponse(ctx: Context, expectedStatus: number): string {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  const ct = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["content-type"] ?? "";
  assert.ok(ct.includes("text/html"), `Expected HTML content-type, got "${ct}"`);
  return (ctx as unknown as { _respBody: string })._respBody;
}

/**
 * Assert status code and JSON content-type, return parsed JSON.
 */
export function jsonResponse(ctx: Context, expectedStatus: number): unknown {
  assert.equal(ctx.status, expectedStatus, `Expected status ${expectedStatus}, got ${ctx.status}`);
  const ct = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["content-type"] ?? "";
  assert.ok(ct.includes("application/json"), `Expected JSON content-type, got "${ct}"`);
  const body = (ctx as unknown as { _respBody: string })._respBody;
  return JSON.parse(body);
}

/**
 * Assert that the response is a redirect and return the target URL.
 */
export function redirectedTo(ctx: Context): string {
  assert.ok(ctx.status >= 300 && ctx.status < 400, `Expected redirect status, got ${ctx.status}`);
  const location = (ctx as unknown as { _respHeaders: Record<string, string> })._respHeaders["location"];
  assert.ok(location, "Expected location header for redirect");
  return location;
}
