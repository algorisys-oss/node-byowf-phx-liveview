[← Step 34: Route Listing CLI](34-route-listing-cli.md) | [Step 36: Logger & Request ID →](36-logger-request-id.md)

# Step 35 — Debug Error Page

## What We're Building

A rich development error page that shows the error message, **source code preview** with the offending line highlighted, full stack trace, and **request context** (method, path, headers, params). In production, a minimal "500 Internal Server Error" page.

## Concepts You'll Learn

- **Source code extraction** — reading files from stack trace paths with `readFileSync`
- **Stack trace parsing** — extracting file path and line number with regex
- **Request context** — capturing method, path, headers, and params for debugging
- **Dev vs prod** — showing detailed errors only in development

## How It Works

### Stack Trace Parsing

When an error is thrown, Node.js generates a stack trace like:
```
Error: Intentional crash
    at /home/user/src/app.ts:256:9
    at Router.call (/home/user/src/blaze/router.ts:118:20)
```

We extract the first `at ... (file:line:col)` match, read that file, and display lines around the error:

```
  Source
  /home/user/src/app.ts:256

     252 │ // -- Error handler demo --
     253 │
     254 │ router.get("/crash", () => {
     255 │   throw new Error("Intentional crash!");
  →  256 │ });
     257 │
```

The offending line gets a red highlight background.

### Request Context

Below the stack trace, we show the HTTP request that triggered the error:

| Field | Value |
|-------|-------|
| Method | GET |
| Path | /crash |
| host | localhost:4001 |
| user-agent | curl/8.x |
| accept | */* |

This helps debug errors that depend on specific request conditions (headers, params, etc.).

### Dev vs Prod

```typescript
const body = dev
  ? devErrorPage(error, { method, path, headers, params: ctx.params })
  : prodErrorPage();
```

- **Dev** (`dev: true`, the default): Full error details, source preview, request context
- **Prod** (`dev: false`): Minimal "500 Internal Server Error" — no stack traces leaked

## The Code

### Changes to `src/blaze/server.ts`

Two new functions in `server.ts` handle error rendering:

```typescript
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
```

Key features:

1. **Source code preview**: Parses the stack trace for the first file:line reference, reads the file with `readFileSync`, and renders lines +/-5 around the error with the offending line highlighted
2. **Request context**: Displays method, path, headers, and route params in a table
3. **Styled layout**: Dark code blocks, red error banner, zebra-striped tables
4. **Production page**: Clean, minimal HTML with no sensitive information

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/crash`
2. You'll see a rich error page with:
   - Red "500 Error" header with the error class name
   - Error message in a pink banner
   - **Source** section showing the file and highlighted error line
   - **Stack Trace** in a dark code block
   - **Request** table with method, path, and all headers
3. Compare with production mode — edit the `serve()` call to pass `dev: false` and visit `/crash` again — you'll see just "500 Internal Server Error"

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/server.ts` | Modified | Rich dev error page with source preview + request context |

## What's Next

**Step 36 — Logger & Request ID:** `AsyncLocalStorage` for per-request IDs, structured logging with response timing.

[← Step 34: Route Listing CLI](34-route-listing-cli.md) | [Step 36: Logger & Request ID →](36-logger-request-id.md)
