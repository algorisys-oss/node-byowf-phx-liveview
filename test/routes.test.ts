/**
 * Route tests using Blaze test helpers.
 * Run with: npm test
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildContext,
  get,
  post,
  del,
  textResponse,
  htmlResponse,
  jsonResponse,
  redirectedTo,
  initTestSession,
  withCsrf,
} from "../src/blaze/test_helpers.js";
import { router } from "../src/app.js";

describe("GET routes", () => {
  it("GET / returns 200 with welcome page", async () => {
    const ctx = await get(router, "/");
    const body = htmlResponse(ctx, 200);
    assert.ok(body.includes("Welcome to Blaze!"));
  });

  it("GET /hello returns plain text", async () => {
    const ctx = await get(router, "/hello");
    const body = textResponse(ctx, 200);
    assert.equal(body, "Hello, Blaze!");
  });

  it("GET /api/status returns JSON", async () => {
    const ctx = await get(router, "/api/status");
    const data = jsonResponse(ctx, 200) as { status: string; framework: string };
    assert.equal(data.status, "ok");
    assert.equal(data.framework, "Blaze");
  });

  it("GET /api/users/:id returns user JSON", async () => {
    const ctx = await get(router, "/api/users/42");
    const data = jsonResponse(ctx, 200) as { user: { id: string; name: string } };
    assert.equal(data.user.id, "42");
    assert.equal(data.user.name, "User 42");
  });

  it("GET /greet/:name returns greeting", async () => {
    const ctx = await get(router, "/greet/Alice");
    const body = textResponse(ctx, 200);
    assert.equal(body, "Hello, Alice!");
  });

  it("GET /old-page redirects to /", async () => {
    const ctx = await get(router, "/old-page");
    const location = redirectedTo(ctx);
    assert.equal(location, "/");
  });

  it("GET /nonexistent returns 404", async () => {
    const ctx = await get(router, "/nonexistent");
    assert.equal(ctx.status, 404);
  });
});

describe("POST routes", () => {
  it("POST /echo returns received body", async () => {
    const ctx = await post(router, "/echo", { name: "Test", age: 25 });
    const data = jsonResponse(ctx, 200) as { received: Record<string, unknown> };
    assert.equal(data.received.name, "Test");
    assert.equal(data.received.age, 25);
  });

  it("POST /echo without CSRF token returns 403", async () => {
    const ctx = buildContext("POST", "/echo", { body: { name: "Evil" } });
    // No initTestSession / withCsrf → should be blocked
    ctx.session = {};
    const result = await router.call(ctx);
    assert.equal(result.status, 403);
  });
});

describe("DELETE routes", () => {
  it("DELETE /echo returns deleted confirmation", async () => {
    const ctx = await del(router, "/echo");
    const data = jsonResponse(ctx, 200) as { method: string; deleted: boolean };
    assert.equal(data.method, "DELETE");
    assert.equal(data.deleted, true);
  });
});

describe("buildContext", () => {
  it("creates context with correct method and path", () => {
    const ctx = buildContext("GET", "/test");
    assert.equal(ctx.method, "GET");
    assert.equal(ctx.path, "/test");
  });

  it("accepts custom headers", () => {
    const ctx = buildContext("GET", "/test", { headers: { "x-custom": "value" } });
    assert.equal(ctx.headers["x-custom"], "value");
  });

  it("accepts body for POST requests", () => {
    const ctx = buildContext("POST", "/test", { body: { key: "val" } });
    assert.deepEqual(ctx.body, { key: "val" });
  });
});
