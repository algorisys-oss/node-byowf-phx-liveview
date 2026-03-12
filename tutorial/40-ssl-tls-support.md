[← Step 39: Health Check](39-health-check.md) | [Step 41: Rate Limiting →](41-rate-limiting.md)

# Step 40 — SSL/TLS Support

## What We're Building

HTTPS support via uWebSockets.js `SSLApp()`. When SSL certificates are provided (via environment variables), the server runs HTTPS instead of HTTP. Both HTTP and WebSocket connections work over TLS.

## Concepts You'll Learn

- **TLS/SSL** — encrypting HTTP traffic with certificates
- **uWS.SSLApp()** — uWebSockets.js HTTPS server (drop-in replacement for `uWS.App()`)
- **Self-signed certificates** — development-only certs generated with `openssl`
- **Environment-based config** — `SSL_KEY` and `SSL_CERT` env vars

## How It Works

### uWS.App() vs uWS.SSLApp()

```typescript
// HTTP (default)
const app = uWS.App();

// HTTPS (when SSL options provided)
const app = uWS.SSLApp({
  key_file_name: "certs/key.pem",
  cert_file_name: "certs/cert.pem",
});
```

`SSLApp()` is a drop-in replacement — all routes, WebSocket handlers, and middleware work identically. The only difference is the transport layer uses TLS.

### Configuration

SSL is enabled by setting environment variables:

```bash
SSL_KEY=certs/key.pem SSL_CERT=certs/cert.pem npm start
```

Without these variables, the server runs plain HTTP (the default for development).

## The Code

### Changes to `src/blaze/server.ts`

We add an `SSLOptions` interface and a new `ssl` field to `ServeOptions`. Inside `serve()`, we conditionally create an `SSLApp` or a plain `App`, and adjust the startup log to show the correct protocol.

Here is the full `src/blaze/server.ts` with all SSL-related additions in context:

```typescript
/**
 * Blaze Server -- HTTP + WebSocket, powered by uWebSockets.js.
 *
 * Equivalent to Ignite.Server in the Elixir version.
 * Provides both HTTP routing and WebSocket-based LiveView connections
 * on the same port.
 *
 * Key uWS constraints handled here:
 * - HttpRequest is stack-allocated: all request data must be read synchronously
 * - HttpResponse requires onAborted() if not responding immediately
 * - Body reading uses res.onData() callback
 * - Response batching via res.cork() for optimal performance
 * - WebSocket upgrade via app.ws() with custom userData
 */

import uWS from "uWebSockets.js";
import { readFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "./context.js";
import type { Router } from "./router.js";
import type { LiveViewClass, LiveConnection } from "./live_handler.js";
import { handleOpen, handleMessage, handleClose, getLiveRoutesMap } from "./live_handler.js";
import * as Session from "./session.js";
import { loggerMiddleware, logRequest, requestStorage, generateRequestId } from "./logger.js";
import { buildManifest, staticPath } from "./static.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface SSLOptions {
  keyFile: string;
  certFile: string;
  passphrase?: string;
}

export interface ServeOptions {
  port?: number;
  router?: Router;
  dev?: boolean;
  liveRoutes?: Map<string, LiveViewClass>;
  ssl?: SSLOptions;
}

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface RequestInfo {
  method: string;
  path: string;
  headers: Record<string, string>;
  params?: Record<string, string>;
}

function devErrorPage(error: unknown, reqInfo?: RequestInfo): string {
  const name = error instanceof Error ? error.constructor.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";

  // Source code preview: read the file from the first stack frame
  let sourcePreview = "";
  if (stack) {
    const match = stack.match(/at .+ \((.+):(\d+):(\d+)\)/);
    if (match) {
      const [, filePath, lineStr] = match;
      const line = parseInt(lineStr!, 10);
      try {
        const content = readFileSync(filePath!, "utf8");
        const lines = content.split("\n");
        const start = Math.max(0, line - 5);
        const end = Math.min(lines.length, line + 5);
        const numbered = lines
          .slice(start, end)
          .map((l: string, i: number) => {
            const num = start + i + 1;
            const marker = num === line ? "\u2192" : " ";
            const highlight = num === line ? ' style="background:#4a2020;display:block;"' : "";
            return `<span${highlight}>${marker} ${String(num).padStart(4)} \u2502 ${htmlEscape(l)}</span>`;
          })
          .join("\n");
        sourcePreview = `
  <h2>Source</h2>
  <p style="color:#888;font-size:0.85rem;">${htmlEscape(filePath!)}:${line}</p>
  <pre class="stack">${numbered}</pre>`;
      } catch {}
    }
  }

  // Request context
  let reqContext = "";
  if (reqInfo) {
    const headerRows = Object.entries(reqInfo.headers)
      .map(([k, v]) => `    <tr><td style="font-weight:bold;">${htmlEscape(k)}</td><td>${htmlEscape(v)}</td></tr>`)
      .join("\n");
    const paramRows = reqInfo.params && Object.keys(reqInfo.params).length > 0
      ? Object.entries(reqInfo.params)
          .map(([k, v]) => `    <tr><td style="font-weight:bold;">${htmlEscape(k)}</td><td>${htmlEscape(v)}</td></tr>`)
          .join("\n")
      : "";
    reqContext = `
  <h2>Request</h2>
  <table class="req-table">
    <tr><td style="font-weight:bold;">Method</td><td>${htmlEscape(reqInfo.method)}</td></tr>
    <tr><td style="font-weight:bold;">Path</td><td>${htmlEscape(reqInfo.path)}</td></tr>
${headerRows}
  </table>${paramRows ? `
  <h2>Params</h2>
  <table class="req-table">
${paramRows}
  </table>` : ""}`;
  }

  return `<!DOCTYPE html>
<html>
<head><title>500 — ${htmlEscape(name)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #333; }
  h1 { color: #c33; border-bottom: 2px solid #c33; padding-bottom: 0.5rem; }
  h2 { color: #666; margin-top: 1.5rem; }
  .error-type { color: #666; font-weight: normal; }
  .message { background: #fff3f3; border: 1px solid #fcc; padding: 1rem; border-radius: 6px; font-size: 1.1rem; }
  .stack { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; line-height: 1.6; white-space: pre; }
  .req-table { border-collapse: collapse; width: 100%; }
  .req-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; font-size: 0.9rem; }
  .req-table tr:nth-child(even) { background: #f9f9f9; }
  .hint { color: #888; margin-top: 2rem; font-size: 0.9rem; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
</head>
<body>
  <h1>500 <span class="error-type">${htmlEscape(name)}</span></h1>
  <div class="message">${htmlEscape(message)}</div>
  ${sourcePreview}
  <h2>Stack Trace</h2>
  <pre class="stack">${htmlEscape(stack)}</pre>
  ${reqContext}
  <p class="hint">This error page is shown in development mode. Set <code>dev: false</code> in production.</p>
</body>
</html>`;
}

function prodErrorPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>500 — Internal Server Error</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem; text-align: center; color: #333; }
  h1 { color: #c33; font-size: 3rem; }
</style>
</head>
<body>
  <h1>500</h1>
  <p>Internal Server Error</p>
</body>
</html>`;
}

/**
 * Generate the HTML shell page for a LiveView route.
 * Container div with data-path attribute, loads blaze.js client.
 */
function liveViewPage(path: string, isDev: boolean, routeMap: string): string {
  const reloadScript = isDev
    ? `\n  <script src="${staticPath("blaze-reload.js")}"></script>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <title>Blaze LiveView</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    button { cursor: pointer; }
    .status { color: #999; font-size: 0.85em; margin-top: 1rem; }
    .status.connected { color: #2a2; }
    .status.disconnected { color: #c33; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="blaze-container" data-path="${path}" data-live-routes="${routeMap}">Connecting...</div>
  <p class="status" id="blaze-status">Connecting...</p>
  <p><a href="/" class="text-blue-600 hover:underline">&larr; Back to home</a></p>

  <script src="${staticPath("morphdom.min.js")}"></script>
  <script src="${staticPath("hooks.js")}"></script>
  <script src="${staticPath("blaze.js")}"></script>${reloadScript}
</body>
</html>`;
}

/**
 * Serve a static file from the public/ directory.
 * Returns true if the file was served, false if not found.
 */
function serveStatic(res: uWS.HttpResponse, filePath: string, hasVersionQuery: boolean = false): boolean {
  // Prevent path traversal
  const normalized = normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(PUBLIC_DIR, normalized);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  try {
    const content = readFileSync(fullPath);
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";

    res.cork(() => {
      res.writeStatus("200");
      res.writeHeader("content-type", mime);
      // Cache-bust: if URL has ?v= query, set long cache (immutable)
      if (hasVersionQuery) {
        res.writeHeader("cache-control", "public, max-age=31536000, immutable");
      }
      res.end(content);
    });
    return true;
  } catch {
    return false;
  }
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4001;
  const router = options.router;
  const dev = options.dev ?? true;
  const liveRoutes = options.liveRoutes ?? new Map();

  const ssl = options.ssl;

  // Build static asset manifest (content hashes for cache-busting URLs)
  buildManifest(PUBLIC_DIR);

  const app = ssl
    ? uWS.SSLApp({
        key_file_name: ssl.keyFile,
        cert_file_name: ssl.certFile,
        passphrase: ssl.passphrase,
      })
    : uWS.App();

  // ── Dev-only: hot reload WebSocket ──
  if (dev) {
    app.ws("/live/reload", {
      open: (ws) => {
        ws.send(JSON.stringify({ type: "reload", status: "ready" }));
      },
      message: () => {},
      close: () => {},
    });
  }

  // Pre-compute the live routes map for client-side navigation
  const routeMap = htmlEscape(JSON.stringify(getLiveRoutesMap(liveRoutes)));

  // ── WebSocket handler for LiveView connections ──
  app.ws<LiveConnection>("/live/websocket", {
    // Allow large binary frames for file upload chunks (default is 16KB)
    maxPayloadLength: 512 * 1024,

    upgrade: (res, req, context) => {
      const query = req.getQuery() ?? "";
      const params = new URLSearchParams(query);
      const path = params.get("path") ?? "/";

      // Must read all headers synchronously before upgrade
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");

      res.upgrade<LiveConnection>(
        { path },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context,
      );
    },

    open: (ws) => {
      handleOpen(ws, liveRoutes).catch((err) => {
        console.error("LiveView open error:", err);
      });
    },

    message: (ws, message, isBinary) => {
      handleMessage(ws, message, isBinary).catch((err) => {
        console.error("LiveView message error:", err);
      });
    },

    close: (ws) => {
      handleClose(ws);
    },
  });

  // ── HTTP handler ──
  app.any("/*", (res, req) => {
    // 1. Extract all request data SYNCHRONOUSLY
    const method = req.getCaseSensitiveMethod();
    const path = req.getUrl();
    const query = req.getQuery() ?? "";

    const headers: Record<string, string> = {};
    req.forEach((key, value) => {
      headers[key] = value;
    });

    // 2. Serve static files from public/ directory
    if (method === "GET" && path.startsWith("/public/")) {
      const filePath = path.slice("/public/".length);
      const hasVersion = query.includes("v=");
      if (serveStatic(res, filePath, hasVersion)) return;
    }

    // 3. Check if this is a LiveView route (GET only)
    if (method === "GET" && liveRoutes.has(path)) {
      res.cork(() => {
        res.writeStatus("200");
        res.writeHeader("content-type", "text/html; charset=utf-8");
        res.end(liveViewPage(path, dev, routeMap));
      });
      return;
    }

    // 3. Track abort state
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });

    // 4. Helper to send a response safely
    const sendResponse = (status: number, respHeaders: Record<string, string>, body: string) => {
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(String(status));
        for (const [k, v] of Object.entries(respHeaders)) {
          res.writeHeader(k, v);
        }
        res.end(body);
      });
    };

    // 5. Handle the request (with body reading if needed)
    const handleRequest = async (rawBody: string) => {
      if (aborted) return;

      const ctx = new Context({ method, path, query, headers, rawBody, sendFn: sendResponse });

      // Parse cookies and decode session
      ctx.cookies = Session.parseCookies(headers["cookie"] ?? "");
      const rawSession = Session.decode(ctx.cookies[Session.cookieName()]);
      // Pop flash from session -> store in private for current request
      const flash = rawSession._flash ?? {};
      delete rawSession._flash;
      ctx.session = rawSession;
      ctx.putPrivate("flash", flash);

      // Assign request ID and start timing
      loggerMiddleware(ctx);

      // Run request within AsyncLocalStorage context
      const requestId = ctx.getPrivate("requestId") as string;
      await requestStorage.run({ requestId }, async () => {
        try {
          if (router) {
            await router.call(ctx);

            // Encode session back to signed cookie
            const sessionCookie = Session.encode(ctx.session);
            ctx.setHeader("set-cookie", `${Session.cookieName()}=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`);

            logRequest(ctx);
            ctx.send();
            return;
          }

          ctx
            .setStatus(200)
            .setHeader("content-type", "text/plain")
            .setBody("Hello, Blaze!");
          logRequest(ctx);
          ctx.send();
        } catch (error) {
          console.error("Unhandled error:", error);
          if (aborted) return;
          ctx.setStatus(500);
          logRequest(ctx);
          const body = dev
            ? devErrorPage(error, {
                method,
                path,
                headers,
                params: ctx.params,
              })
            : prodErrorPage();
          sendResponse(500, { "content-type": "text/html; charset=utf-8" }, body);
        }
      });
    };

    // 6. Read body or dispatch immediately
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      let buffer = Buffer.alloc(0);
      res.onData((chunk, isLast) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (isLast) {
          handleRequest(buffer.toString("utf-8"));
        }
      });
    } else {
      handleRequest("");
    }
  });

  app.listen(port, (listenSocket) => {
    if (listenSocket) {
      const protocol = ssl ? "https" : "http";
      console.log(`Blaze is heating up on ${protocol}://localhost:${port}`);
    } else {
      console.error(`Failed to listen on port ${port}`);
    }
  });

  return app;
}
```

The key SSL additions are:

1. **`SSLOptions` interface** (lines 42-46) -- defines `keyFile`, `certFile`, and optional `passphrase`.
2. **`ssl` field in `ServeOptions`** (line 53) -- optional SSL configuration.
3. **Conditional app creation** (lines 249-255) -- uses `uWS.SSLApp()` when SSL options are provided, otherwise `uWS.App()`.
4. **Protocol-aware log** (line 433) -- prints `https://` when SSL is active.

### Changes to `src/app.ts`

At the bottom of `src/app.ts`, where the server starts, read SSL config from environment variables:

```typescript
// Only start the server when app.ts is the entry point (not when imported by CLI tools)
const isMain = process.argv[1]?.endsWith("app.ts") || process.argv[1]?.endsWith("app.js");
if (isMain) {
  const ssl = process.env.SSL_KEY && process.env.SSL_CERT
    ? { keyFile: process.env.SSL_KEY, certFile: process.env.SSL_CERT }
    : undefined;
  serve({ port: 4001, router, liveRoutes, ssl });
}
```

When `SSL_KEY` and `SSL_CERT` are both set, we pass them to `serve()`. Otherwise `ssl` is `undefined` and the server runs plain HTTP.

### `scripts/gen-cert.sh` (new)

Generates self-signed certificates for development:

```bash
#!/bin/bash
# Generate self-signed SSL certificate for development
# Usage: bash scripts/gen-cert.sh

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost"

echo "Generated: $CERT_DIR/key.pem, $CERT_DIR/cert.pem"
echo ""
echo "Start with SSL:"
echo "  SSL_KEY=certs/key.pem SSL_CERT=certs/cert.pem npm start"
```

### `.gitignore` addition

Add `certs/` to `.gitignore` so generated certificates are not committed:

```
certs/
```

## Try It Out

```bash
# Generate dev certificates
bash scripts/gen-cert.sh

# Start with HTTPS
SSL_KEY=certs/key.pem SSL_CERT=certs/cert.pem npm start

# Test (use -k to skip cert verification for self-signed)
curl -sk https://localhost:4001/health
curl -sk https://localhost:4001/hello
```

For production, use certificates from Let's Encrypt or your CA:
```bash
SSL_KEY=/etc/letsencrypt/live/example.com/privkey.pem \
SSL_CERT=/etc/letsencrypt/live/example.com/fullchain.pem \
npm start
```

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/server.ts` | Modified | `SSLOptions` interface, conditional `SSLApp()` |
| `src/app.ts` | Modified | Read SSL config from env vars |
| `scripts/gen-cert.sh` | **New** | Self-signed cert generator |
| `.gitignore` | Modified | Ignore `certs/` directory |

## What's Next

**Step 41 — Rate Limiting:** Sliding window rate limiter per IP with `x-ratelimit-*` headers.

[← Step 39: Health Check](39-health-check.md) | [Step 41: Rate Limiting →](41-rate-limiting.md)
