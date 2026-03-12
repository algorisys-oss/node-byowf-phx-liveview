# Step 13: Error Handler

[← Previous: Step 12 - Path Helpers](12-path-helpers.md) | [Next: Step 14 - uWebSockets.js Migration →](14-uwebsockets-migration.md)

---

## What We're Building

Right now, if a route handler throws an exception, Node.js's default
behavior takes over -- the request hangs or the server may crash. The
user sees nothing useful, and we have no control over the response.

In this step, we add an **error boundary** -- a try/catch around route
dispatch that:

1. Catches any unhandled exception (sync or async)
2. Logs the error to the console
3. Returns a styled **500 error page**
4. Shows **full details in dev mode** (error name, message, stack trace)
5. Shows a **generic page in production** (no sensitive info leaked)

The server keeps running after errors -- one bad request doesn't take
down the whole application.

### How This Compares to Ignite (Elixir)

In the Elixir version, the adapter's `init/2` function wraps the entire
pipeline in `try/rescue`:

```elixir
try do
  conn = Router.call(conn)
  send_response(conn)
rescue
  error ->
    Logger.error(Exception.format(:error, error, __STACKTRACE__))
    send_error_page(error)
end
```

Elixir's "Let It Crash" philosophy means processes crash individually --
the supervisor restarts them. In Node.js, we're single-process, so we
catch errors at the HTTP boundary and keep serving.

## Concepts You'll Learn

### Error Boundary Pattern

The error boundary sits at the outermost layer -- the `createServer()`
handler. Every request flows through it:

```
Request → try { middleware → router → handler } catch { error page }
```

This catches errors from:
- Middleware functions
- Route handlers (sync and async)
- Body parsing
- Template rendering
- Anything that throws during request processing

### Dev vs Prod Error Pages

**Development mode** (`dev: true`, the default):
- Shows the error class name (e.g., `TypeError`)
- Shows the error message
- Shows the full stack trace with file paths and line numbers
- Includes a hint that this page is dev-only

**Production mode** (`dev: false`):
- Shows a generic "500 Internal Server Error"
- No error details, no stack trace, no file paths
- Prevents information leakage to attackers

### HTML Escaping

Error messages could contain user input or special characters. The
`htmlEscape()` function prevents XSS by escaping `<`, `>`, `&`, and `"`:

```typescript
function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Mechanism | `try/rescue` in adapter | `try/catch` in `fetch()` | `try/catch` in `createServer()` |
| Stack trace | `__STACKTRACE__` | `error.stack` | `error.stack` |
| Crash isolation | Per-process (OTP) | Per-request (catch) | Per-request (catch) |
| Error info | `Exception.format/3` | `.constructor.name` + `.message` | `.constructor.name` + `.message` |
| HTML safety | `html_escape/1` | `htmlEscape()` | `htmlEscape()` |
| Response | Return new `Response` | Return new `Response` | `res.writeHead()` + `res.end()` |

## The Code

### `src/blaze/server.ts` -- Error Boundary

```typescript
export interface ServeOptions {
  port?: number;
  router?: Router;
  dev?: boolean;        // ← new: controls error page detail
}

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function devErrorPage(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";

  return `<!DOCTYPE html>
<html>
<head><title>500 — ${htmlEscape(name)}</title>
<style>
  body { font-family: system-ui; max-width: 800px; margin: 2rem auto; }
  h1 { color: #c33; }
  .message { background: #fff3f3; border: 1px solid #fcc; padding: 1rem; }
  .stack { background: #1e1e1e; color: #d4d4d4; padding: 1rem; }
  .hint { color: #999; font-size: 0.85em; }
</style>
</head>
<body>
  <h1>500 <span>${htmlEscape(name)}</span></h1>
  <div class="message">${htmlEscape(message)}</div>
  <h2>Stack Trace</h2>
  <pre class="stack">${htmlEscape(stack)}</pre>
  <p class="hint">This error page is shown in development mode.
     Set <code>dev: false</code> in production.</p>
</body>
</html>`;
}

function prodErrorPage(): string {
  return `<html><body><h1>500</h1><p>Internal Server Error</p></body></html>`;
}

export function serve(options: ServeOptions = {}): Server {
  const port = options.port ?? 4001;
  const router = options.router;
  const dev = options.dev ?? true;

  const server = createServer(async (req, res) => {
    const ctx = new Context(req, res);

    try {
      if (router) {
        await router.call(ctx);
        ctx.send();
        return;
      }

      ctx.setStatus(200).setHeader("content-type", "text/plain").setBody("Hello, Blaze!");
      ctx.send();
    } catch (error) {
      console.error("Unhandled error:", error);
      const body = dev ? devErrorPage(error) : prodErrorPage();
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    }
  });

  server.listen(port, () => {
    console.log(`Blaze is heating up on http://localhost:${port}`);
  });

  return server;
}
```

**Key decisions:**

- **`dev` defaults to `true`:** During development you want full error
  details. Set `dev: false` explicitly for production.
- **`error: unknown`:** TypeScript types catch values as `unknown`. We
  check `instanceof Error` before accessing `.message` and `.stack`.
- **Console logging always happens:** Even in prod mode, the full error
  is logged to the server console for debugging.
- **HTML escaping:** All error text is escaped before insertion into HTML,
  preventing XSS even if error messages contain markup.
- **Direct `res.writeHead()`/`res.end()`:** In the catch block, we bypass
  the Context and write directly to the response, since the Context may
  be in an inconsistent state after the error.

### `src/app.ts` -- Crash Demo Route

```typescript
// Error handler demo: throws to test 500 page
router.get("/crash", () => {
  throw new Error("Intentional crash to test error handling!");
});
```

## How It Works

### Normal Request Flow

```
GET /hello
→ try { middleware pipeline → route match → handler → ctx.send() }
→ 200 OK "Hello, Blaze!"
```

### Error Request Flow

```
GET /crash
→ try { middleware pipeline → route match → handler throws Error }
→ catch { console.error(), res.writeHead(500), res.end(errorPage) }
→ 500 "Intentional crash to test error handling!"
```

### Post-Error Recovery

```
GET /hello  (after /crash)
→ try { middleware pipeline → route match → handler → ctx.send() }
→ 200 OK "Hello, Blaze!"   ← server still works fine
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the crash route

Visit http://localhost:4001/crash -- you'll see a styled error page with
the error name, message, and full stack trace.

### 3. Verify the server survived

```bash
curl http://localhost:4001/hello
# Hello, Blaze!
```

The server keeps running. Each request is isolated.

### 4. Test production mode

Change the serve call in `src/app.ts`:

```typescript
serve({ port: 4001, router, dev: false });
```

Visit http://localhost:4001/crash -- now you see only "500 Internal
Server Error" with no details leaked.

### 5. Check the console

The server console always shows the full error regardless of mode:

```
GET /crash
Unhandled error: Error: Intentional crash to test error handling!
    at Object.handler (/home/.../src/app.ts:171:9)
    at Router.call (/home/.../src/blaze/router.ts:131:30)
    ...
```

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/server.ts` | **Modified** | try/catch boundary, `dev`/prod error pages, `htmlEscape()` |
| `src/app.ts` | **Modified** | Added `/crash` demo route, landing page link |

---

[← Previous: Step 12 - Path Helpers](12-path-helpers.md) | [Next: Step 14 - uWebSockets.js Migration →](14-uwebsockets-migration.md)

## What's Next

This completes **Module 1: HTTP Foundations**. We now have a full HTTP
framework with routing, templates, middleware, body parsing, content
negotiation, scoped routes, path helpers, and error handling -- all on
vanilla `node:http` with zero external dependencies.

In **Step 14**, we begin **Module 2: LiveView Core** -- migrating to
**uWebSockets.js** for HTTP + WebSocket support, the foundation for
real-time interactivity in Blaze.
