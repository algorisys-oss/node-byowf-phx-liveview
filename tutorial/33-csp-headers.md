# Step 33 — CSP Headers

## What We're Building

A Content Security Policy (CSP) middleware that generates per-request nonces for inline scripts. The browser blocks any script without the correct nonce, preventing XSS attacks even if an attacker manages to inject HTML.

## Concepts You'll Learn

- **Content Security Policy** — an HTTP header telling the browser what resources are allowed
- **Nonces** — one-time random values that authorize specific inline scripts
- **Defense in depth** — CSP + CSRF + escaping = layered protection

## How It Works

### The Problem

Even with HTML escaping, XSS vulnerabilities can sneak in through:
- Template injection bugs
- Third-party scripts
- DOM-based XSS (manipulating the DOM via URL fragments)

CSP adds a **browser-enforced** layer: the server tells the browser "only run scripts I explicitly authorize."

### The Solution

```
GET /echo
  → CSP middleware:
    → Generate random nonce: "abc123..."
    → Store in ctx private state
    → Set header: Content-Security-Policy:
        default-src 'self';
        script-src 'self' 'nonce-abc123...';
        style-src 'self' 'unsafe-inline';
        connect-src 'self' ws: wss:;
        ...
  → Route handler:
    → getNonce(ctx) → "abc123..."
    → <script nonce="abc123...">sendJson()</script>  ← allowed
    → <script>alert('xss')</script>                   ← BLOCKED by browser
```

### CSP Directives

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Only load resources from same origin |
| `script-src` | `'self' 'nonce-...'` | Scripts must be same-origin OR have the nonce |
| `style-src` | `'self' 'unsafe-inline'` | Allow inline styles (needed for component styling) |
| `img-src` | `'self' data: blob:` | Images from same origin, data URIs, or blob URLs |
| `connect-src` | `'self' ws: wss:` | Allow WebSocket connections (LiveView) |
| `object-src` | `'none'` | Block Flash, Java applets, etc. |
| `base-uri` | `'self'` | Prevent `<base>` tag hijacking |
| `form-action` | `'self'` | Forms can only submit to same origin |

## The Code

### `src/blaze/csp.ts` (new)

```typescript
import type { Context } from "./context.js";

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64");
}

export function getNonce(ctx: Context): string {
  let nonce = ctx.getPrivate("csp_nonce") as string | undefined;
  if (!nonce) {
    nonce = generateNonce();
    ctx.putPrivate("csp_nonce", nonce);
  }
  return nonce;
}

export function cspMiddleware(ctx: Context): Context {
  const nonce = getNonce(ctx);

  const policy = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self' ws: wss:`,
    `font-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");

  ctx.setHeader("content-security-policy", policy);
  return ctx;
}
```

The nonce is stored in `ctx._private` (per-request state) so `getNonce(ctx)` returns the same value throughout a single request, but a different value for each request.

### Integration in `src/app.ts`

```typescript
import { cspMiddleware, getNonce } from "./blaze/csp.js";

// Middleware (after CSRF, before routes)
router.use((ctx) => cspMiddleware(ctx));

// In inline scripts — add the nonce attribute:
`<script nonce="${getNonce(ctx)}">
async function sendJson() { ... }
</script>`
```

External scripts loaded via `<script src="/public/blaze.js">` are allowed by `script-src 'self'` — no nonce needed.

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/echo`
2. Open DevTools → Network tab → check the response headers:
   ```
   content-security-policy: default-src 'self'; script-src 'self' 'nonce-...'; ...
   ```
3. The "Send JSON" button works (script has the nonce)
4. Open DevTools → Console, type: `eval("alert('xss')")` → **Blocked by CSP!**
   (You'll see: "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source")
5. Try injecting a script without nonce in the Console:
   ```js
   document.body.innerHTML += '<script>alert(1)</script>';
   ```
   The injected script **won't execute** — no nonce, blocked by CSP
6. Verify nonce matches between header and HTML:
   ```bash
   curl -s -D - http://localhost:4001/echo | grep -oP "nonce-\K[^']+"
   # Both lines should show the same nonce value
   ```
7. Refresh the page — the nonce in the header changes each time

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/csp.ts` | **New** | CSP nonce generation + middleware |
| `src/app.ts` | Modified | Added CSP middleware + nonce on inline script |

## What's Next

**Step 34 — Route Listing CLI:** A CLI tool that prints all registered routes, methods, and names — like `mix phx.routes`.
