import { serve } from "./blaze/server.js";
import { Router } from "./blaze/router.js";
import { text, html, json, redirect, render, putFlash, getFlash, csrfTokenTag, verifyCsrfToken } from "./blaze/controller.js";
import { cspMiddleware, getNonce } from "./blaze/csp.js";
import { healthCheck } from "./blaze/health.js";
import { rateLimit } from "./blaze/rate_limit.js";
import { CounterLive } from "./my_app/counter_live.js";
import { DashboardLive } from "./my_app/dashboard_live.js";
import { SharedCounterLive } from "./my_app/shared_counter_live.js";
import { ComponentsDemoLive } from "./my_app/components_demo_live.js";
import { HooksDemoLive } from "./my_app/hooks_demo_live.js";
import { StreamDemoLive } from "./my_app/stream_demo_live.js";
import { TempAssignsDemoLive } from "./my_app/temp_assigns_demo_live.js";
import { UploadDemoLive } from "./my_app/upload_demo_live.js";
import { PresenceDemoLive } from "./my_app/presence_demo_live.js";
import { GuestbookLive } from "./my_app/guestbook_live.js";
import { TodoLive } from "./my_app/todo_live.js";
import type { LiveViewClass } from "./blaze/live_handler.js";

export const router = new Router();

// -- Middleware --

// Rate limiting (100 requests per minute per IP)
router.use(rateLimit({ max: 100, windowMs: 60_000 }));

// Add X-Powered-By header to every response
router.use((ctx) => {
  ctx.setHeader("x-powered-by", "Blaze");
  return ctx;
});

// Parse request body for POST/PUT/PATCH
router.use((ctx) => {
  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    return ctx.parseBody();
  }
  return ctx;
});

// CSRF protection for state-changing requests (must be after body parsing)
router.use((ctx) => verifyCsrfToken(ctx));

// Content Security Policy with per-request nonce
router.use((ctx) => cspMiddleware(ctx));

// -- Routes --

router.get("/", (ctx) =>
  html(
    ctx,
    `<h1>Welcome to Blaze!</h1>
<p>A Phoenix-like framework for Node.js</p>
<h2>Routes to try:</h2>
<ul>
  <li><a href="/hello">/hello</a> — plain text</li>
  <li><a href="/api/status">/api/status</a> — scoped JSON API</li>
  <li><a href="/api/users/42">/api/users/42</a> — scoped API route</li>
  <li><a href="/users/42">/users/42</a> — content negotiation (HTML/JSON)</li>
  <li><a href="/posts/7/comments/3">/posts/7/comments/3</a> — multi-param route</li>
  <li><a href="/greet/world">/greet/world</a> — greeting with param</li>
  <li><a href="/profile/42">/profile/42</a> — template-rendered profile</li>
  <li><a href="/old-page">/old-page</a> — redirect to /</li>
  <li><a href="/echo">/echo</a> — POST body parser (form + JSON, CSRF-protected)</li>
  <li><a href="/routes">/routes</a> — route listing + path helpers</li>
  <li><a href="/flash">/flash</a> — flash messages &amp; sessions</li>
  <li><a href="/health">/health</a> — health check (uptime, memory, connections)</li>
  <li><a href="/crash">/crash</a> — error handler (500 page)</li>
  <li><a href="/nope">/nope</a> — 404 page</li>
</ul>
<h2>LiveView</h2>
<ul>
  <li><a href="/counter">/counter</a> — real-time counter (WebSocket LiveView)</li>
  <li><a href="/dashboard">/dashboard</a> — multi-dynamic dashboard (nested bv templates)</li>
  <li><a href="/shared-counter">/shared-counter</a> — shared counter (PubSub across tabs)</li>
  <li><a href="/components">/components</a> — LiveComponents (reusable stateful components)</li>
  <li><a href="/hooks">/hooks</a> — JS Hooks (client-side lifecycle callbacks)</li>
  <li><a href="/streams">/streams</a> — LiveView Streams (efficient list rendering)</li>
  <li><a href="/temp-assigns">/temp-assigns</a> — Temporary Assigns (memory-efficient state)</li>
  <li><a href="/uploads">/uploads</a> — File Uploads (chunked binary WebSocket uploads)</li>
  <li><a href="/presence">/presence</a> — Presence Tracking (who's online)</li>
  <li><a href="/guestbook">/guestbook</a> — Guestbook (SQLite database, real-time sync)</li>
  <li><a href="/todos">/todos</a> — <strong>Todo App</strong> (full CRUD with Ember ORM, real-time sync)</li>
</ul>`,
  ),
);

router.get("/hello", (ctx) => text(ctx, "Hello, Blaze!"), "hello");

router.get("/old-page", (ctx) => redirect(ctx, "/"));

// -- Scoped API routes --

router.scope("/api", (r) => {
  r.get("/status", (ctx) => json(ctx, { status: "ok", framework: "Blaze" }), "api_status");

  r.get("/users/:id", (ctx) =>
    json(ctx, { user: { id: ctx.params.id, name: `User ${ctx.params.id}` } }),
  "api_user");
});

router.get("/users/:id", (ctx) => {
  const user = { id: ctx.params.id, name: `User ${ctx.params.id}` };

  if (ctx.accepts("application/json") && !ctx.accepts("text/html")) {
    return json(ctx, { user });
  }

  return html(
    ctx,
    `<h1>${user.name}</h1><p>ID: ${user.id}</p><p><a href="/">← Home</a></p>`,
  );
}, "user");

router.get("/posts/:postId/comments/:id", (ctx) =>
  json(ctx, { postId: ctx.params.postId, commentId: ctx.params.id }),
"post_comment");

router.get("/greet/:name", (ctx) => text(ctx, `Hello, ${ctx.params.name}!`), "greet");

// -- Echo routes (POST body parser demo) --

router.get("/echo", (ctx) =>
  html(
    ctx,
    `<h1>Echo POST</h1>
<h2>Form (URL-encoded)</h2>
<form method="POST" action="/echo">
  ${csrfTokenTag(ctx)}
  <label>Name: <input name="name" value="Alice"></label><br><br>
  <label>Email: <input name="email" value="alice@example.com"></label><br><br>
  <button type="submit">Submit Form</button>
</form>
<h2>JSON (via fetch)</h2>
<button onclick="sendJson()">Send JSON</button>
<pre id="result"></pre>
<script nonce="${getNonce(ctx)}">
async function sendJson() {
  const csrfToken = document.querySelector('[name=_csrf_token]').value;
  const res = await fetch("/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", age: 30, _csrf_token: csrfToken })
  });
  const data = await res.json();
  document.getElementById("result").textContent = JSON.stringify(data, null, 2);
}
</script>
<p><a href="/">← Back to home</a></p>`,
  ),
);

router.post("/echo", (ctx) => json(ctx, { received: ctx.body }));

// -- REST demo (all HTTP methods) --

router.put("/echo", (ctx) => json(ctx, { method: "PUT", received: ctx.body }));
router.patch("/echo", (ctx) => json(ctx, { method: "PATCH", received: ctx.body }));
router.delete("/echo", (ctx) => json(ctx, { method: "DELETE", deleted: true }));

router.get("/profile/:id", (ctx) =>
  render(ctx, "profile", {
    id: ctx.params.id,
    name: `User ${ctx.params.id}`,
    email: `user${ctx.params.id}@example.com`,
  }),
"profile");

// -- Route listing + path helper demo --

router.get("/routes", (ctx) => {
  const routes = router.getRoutes();
  const rows = routes
    .map((r) => `<tr><td>${r.method}</td><td>${r.path}</td><td>${r.name ?? ""}</td></tr>`)
    .join("\n");

  const examples = [
    `pathFor("hello") → ${router.pathFor("hello")}`,
    `pathFor("user", { id: 42 }) → ${router.pathFor("user", { id: 42 })}`,
    `pathFor("api_user", { id: 99 }) → ${router.pathFor("api_user", { id: 99 })}`,
    `pathFor("post_comment", { postId: 7, id: 3 }) → ${router.pathFor("post_comment", { postId: 7, id: 3 })}`,
    `pathFor("profile", { id: 1 }) → ${router.pathFor("profile", { id: 1 })}`,
  ];

  return html(
    ctx,
    `<h1>Registered Routes</h1>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Method</th><th>Path</th><th>Name</th></tr>
${rows}
</table>
<h2>Path Helper Examples</h2>
<pre>${examples.join("\n")}</pre>
<p><a href="/">← Back to home</a></p>`,
  );
}, "routes");

// -- Flash messages & sessions demo --

router.get("/flash", (ctx) => {
  const flash = getFlash(ctx);
  const flashHtml = flash.info
    ? `<div style="padding:0.8rem 1rem; margin:1rem 0; background:#d4edda; border:1px solid #c3e6cb; border-radius:4px; color:#155724;">
         ${flash.info}
       </div>`
    : "";
  const flashError = flash.error
    ? `<div style="padding:0.8rem 1rem; margin:1rem 0; background:#f8d7da; border:1px solid #f5c6cb; border-radius:4px; color:#721c24;">
         ${flash.error}
       </div>`
    : "";

  const visits = ((ctx.session.visits as number) || 0) + 1;
  ctx.session.visits = visits;

  return html(
    ctx,
    `<h1>Flash Messages & Sessions</h1>
${flashHtml}${flashError}
<p>Session visits: <strong>${visits}</strong> (stored in signed cookie)</p>
<h2>Try Flash Messages</h2>
<form method="POST" action="/flash/send">
  ${csrfTokenTag(ctx)}
  <label>Type:
    <select name="type">
      <option value="info">Info (green)</option>
      <option value="error">Error (red)</option>
    </select>
  </label>
  <label style="margin-left:0.5rem;">Message:
    <input name="message" value="Hello from flash!" style="width:250px;" />
  </label>
  <button type="submit" style="margin-left:0.5rem;">Send Flash</button>
</form>
<p style="color:#888; font-size:0.85rem; margin-top:1rem;">
  Flash messages survive one redirect, then disappear. Session data persists across requests via a signed cookie.
</p>
<p><a href="/">← Back to home</a></p>`,
  );
}, "flash");

router.post("/flash/send", (ctx) => {
  const type = (ctx.body.type as string) || "info";
  const message = (ctx.body.message as string) || "Flash!";
  putFlash(ctx, type, message);
  return redirect(ctx, "/flash");
});

// -- Health check --

router.get("/health", (ctx) => healthCheck(ctx), "health");

// -- Error handler demo --

router.get("/crash", () => {
  throw new Error("Intentional crash to test error handling!");
});

// -- LiveView routes --

export const liveRoutes = new Map<string, LiveViewClass>([
  ["/counter", CounterLive],
  ["/dashboard", DashboardLive],
  ["/shared-counter", SharedCounterLive],
  ["/components", ComponentsDemoLive],
  ["/hooks", HooksDemoLive],
  ["/streams", StreamDemoLive],
  ["/temp-assigns", TempAssignsDemoLive],
  ["/uploads", UploadDemoLive],
  ["/presence", PresenceDemoLive],
  ["/guestbook", GuestbookLive],
  ["/todos", TodoLive],
]);

// Only start the server when app.ts is the entry point (not when imported by CLI tools)
const isMain = process.argv[1]?.endsWith("app.ts") || process.argv[1]?.endsWith("app.js");
if (isMain) {
  const ssl = process.env.SSL_KEY && process.env.SSL_CERT
    ? { keyFile: process.env.SSL_KEY, certFile: process.env.SSL_CERT }
    : undefined;
  serve({ port: 4001, router, liveRoutes, ssl });
}
