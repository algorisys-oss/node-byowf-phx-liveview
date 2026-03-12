# Step 32 — CSRF Protection

## What We're Building

Cross-Site Request Forgery (CSRF) protection for all state-changing requests. Every POST, PUT, PATCH, and DELETE form must include a masked token that validates against a per-session secret. Without it — 403 Forbidden.

## Concepts You'll Learn

- **CSRF attacks** — how malicious sites trick browsers into submitting forged requests
- **Token masking** — XOR with random mask to prevent BREACH compression attacks
- **Constant-time comparison** — `crypto.timingSafeEqual()` to prevent timing attacks
- **Middleware integration** — protecting all state-changing routes automatically

## How It Works

### The Attack

```
Attacker's site (evil.com)                Your app (localhost:4001)
    │                                          │
    │  <form action="localhost:4001/flash/send" │
    │   method="POST">                         │
    │   <input name="type" value="error">      │
    │   <input name="message" value="hacked">  │
    │  </form>                                 │
    │  <script>form.submit()</script>          │
    │──────── browser sends POST ─────────────>│
    │         (with user's session cookie!)     │
    │                                          │── 403 Forbidden!
    │                                          │   No _csrf_token in body
```

The browser automatically sends cookies with every request to your domain. Without CSRF protection, any site could submit forms to your app as if the user did it.

### The Solution

```
GET /echo (first visit)
  → Session middleware: decode signed cookie
  → CSRF middleware: skips (safe method)
  → Route handler:
    → ensureToken(ctx) → generate 32-byte random token
    → Store in session → session._csrf_token = "abc123..."
    → maskToken("abc123...") → hex(randomMask) + hex(mask XOR token)
    → Embed in form: <input type="hidden" name="_csrf_token" value="...">
  → Set-Cookie: _blaze_session=<signed(session with CSRF token)>

POST /echo (form submit)
  → Session middleware: decode signed cookie → session._csrf_token = "abc123..."
  → Body parser: parse form → body._csrf_token = "masked_value"
  → CSRF middleware:
    → Split masked_value in half: mask | masked
    → XOR(mask, masked) → unmasked
    → timingSafeEqual(unmasked, session_token) → MATCH ✓
  → Route handler executes normally
```

### Why Masking?

The BREACH attack can extract secrets from compressed HTTPS responses by measuring response sizes. If the CSRF token appears verbatim in HTML, an attacker can guess it byte-by-byte.

Masking with a random XOR ensures each page render produces a **different-looking token** that validates to the same secret:

```
Session token:  a1b2c3d4...  (never changes within session)
Page render 1:  f7e8d9c0... + xor(f7e8d9c0, a1b2c3d4) = f7e8d9c0565a1a14...
Page render 2:  3a4b5c6d... + xor(3a4b5c6d, a1b2c3d4) = 3a4b5c6d9bf99fb9...
Both validate to: a1b2c3d4...
```

## The Code

### `src/blaze/csrf.ts` (new)

```typescript
import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import type { Context } from "./context.js";

const TOKEN_BYTES = 32;

// Generate random 32-byte hex token (stored in session)
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return toHex(bytes);
}

// Mask token: hex(mask) + hex(mask XOR token)
export function maskToken(token: string): string {
  const tokenBytes = fromHex(token);
  const mask = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const masked = new Uint8Array(TOKEN_BYTES);
  for (let i = 0; i < TOKEN_BYTES; i++) {
    masked[i] = mask[i]! ^ tokenBytes[i]!;
  }
  return toHex(mask) + toHex(masked);
}

// Validate: split in half, XOR, constant-time compare
export function validateToken(maskedToken: string, sessionToken: string): boolean {
  if (!maskedToken || !sessionToken) return false;
  if (maskedToken.length !== TOKEN_BYTES * 4) return false;

  const mask = fromHex(maskedToken.slice(0, TOKEN_BYTES * 2));
  const masked = fromHex(maskedToken.slice(TOKEN_BYTES * 2));
  const unmasked = new Uint8Array(TOKEN_BYTES);
  for (let i = 0; i < TOKEN_BYTES; i++) {
    unmasked[i] = mask[i]! ^ masked[i]!;
  }
  const a = Buffer.from(toHex(unmasked));
  const b = Buffer.from(sessionToken);
  if (a.length !== b.length) return false;
  return cryptoTimingSafeEqual(a, b);
}

// HTML hidden input helper
export function csrfTokenTag(ctx: Context): string {
  const token = ensureToken(ctx);
  return `<input type="hidden" name="_csrf_token" value="${maskToken(token)}" />`;
}

// Middleware: verify on POST/PUT/PATCH/DELETE, skip GET/HEAD/OPTIONS
export function verifyCsrfToken(ctx: Context): Context {
  if (["GET", "HEAD", "OPTIONS"].includes(ctx.method)) return ctx;

  const sessionToken = ctx.session._csrf_token as string | undefined;
  const submittedToken = (ctx.body._csrf_token as string) ?? "";

  if (!sessionToken || !validateToken(submittedToken, sessionToken)) {
    ctx.setStatus(403)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setBody("<h1>403 Forbidden</h1><p>Invalid CSRF token.</p>")
      .halt();
  }

  return ctx;
}

// -- Helpers --

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

Key Node.js difference from the Bun version: we use `node:crypto`'s `timingSafeEqual()` for proper constant-time comparison instead of hand-rolling it.

### Integration in `src/app.ts`

```typescript
import { csrfTokenTag, verifyCsrfToken } from "./blaze/controller.js";

// Middleware (after body parsing, before routes)
router.use((ctx) => verifyCsrfToken(ctx));

// In form HTML:
`<form method="POST" action="/echo">
  ${csrfTokenTag(ctx)}
  <input name="name" value="Alice">
  <button type="submit">Submit</button>
</form>`

// For JSON fetch:
`const csrfToken = document.querySelector('[name=_csrf_token]').value;
fetch('/echo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Bob', _csrf_token: csrfToken })
});`
```

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/echo` — submit the form (should work, CSRF token included)
2. Visit `http://localhost:4001/flash` — send a flash message (should work)
3. Test without token:
   ```bash
   curl -X POST -d "name=Evil" http://localhost:4001/echo
   # → 403 Forbidden (no CSRF token)
   ```
4. Inspect the form HTML — the `_csrf_token` hidden input has a 128-character hex value
5. Refresh the page — the token looks different each time (masking), but still validates
6. Simulate a cross-site attack — save this as a local HTML file and open in browser:
   ```html
   <h1>Evil Site</h1>
   <form action="http://localhost:4001/echo" method="POST">
     <input name="name" value="Hacked!">
     <button>Attack</button>
   </form>
   ```
   Click "Attack" → **403 Forbidden** (no valid CSRF token)

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/csrf.ts` | **New** | CSRF token generation, masking, validation, middleware |
| `src/blaze/controller.ts` | Modified | Re-exports `csrfTokenTag`, `verifyCsrfToken` |
| `src/app.ts` | Modified | Added CSRF middleware + token tags in forms |

## What's Next

**Step 33 — CSP Headers:** Nonce-based Content Security Policy to lock down inline scripts and prevent XSS.
