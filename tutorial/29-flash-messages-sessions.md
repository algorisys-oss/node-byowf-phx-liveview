# Step 29 — Flash Messages & Sessions

## What We're Building

A signed cookie-based session system and flash messages — the two-step data pattern where a message set on one request survives exactly one redirect, then disappears. Just like Phoenix's `put_flash/3` and `get_flash/2`.

## Concepts You'll Learn

- **HMAC-SHA256 cookie signing** — tamper-proof sessions without a server-side store
- **Flash messages** — one-shot data that survives a single redirect
- **Cookie parsing** — manual `Cookie` header parsing (no framework magic)
- **Timing-safe comparison** — preventing timing attacks on signature verification

## The Code

### 1. Session Module (`src/blaze/session.ts`)

The session module handles encoding/decoding session data into signed cookies:

```typescript
import { createHmac, timingSafeEqual as tsEqual } from "node:crypto";

const COOKIE_NAME = "_blaze_session";
const DEFAULT_SECRET = "blaze-secret-key-change-in-prod-min-64-bytes-long-for-security!!";

let secretKey: string = process.env.SECRET_KEY_BASE ?? DEFAULT_SECRET;
```

**Encode** serializes session data to JSON, base64-encodes it, and signs with HMAC:

```typescript
export function encode(session: Record<string, unknown>): string {
  const payload = JSON.stringify(session);
  const payloadB64 = Buffer.from(payload).toString("base64");
  const signature = hmacSign(payloadB64);
  return `${payloadB64}.${signature}`;
}
```

**Decode** verifies the HMAC signature before parsing:

```typescript
export function decode(cookieValue: string | undefined): Record<string, unknown> {
  if (!cookieValue) return {};
  const dotIdx = cookieValue.lastIndexOf(".");
  if (dotIdx < 0) return {};

  const payloadB64 = cookieValue.slice(0, dotIdx);
  const signature = cookieValue.slice(dotIdx + 1);
  const expected = hmacSign(payloadB64);
  if (!timingSafeEqual(signature, expected)) return {};

  const payload = Buffer.from(payloadB64, "base64").toString("utf-8");
  return JSON.parse(payload);
}
```

Key design decisions:
- **Synchronous** — uses `node:crypto` `createHmac` (not `crypto.subtle` which is async)
- **Timing-safe comparison** — `timingSafeEqual` from `node:crypto` prevents timing attacks
- **No encryption** — session data is visible (base64) but tamper-proof (HMAC). For sensitive data, add encryption layer

### 2. Context Changes (`src/blaze/context.ts`)

Two new fields on `Context`:

```typescript
// -- Cookies (filled by session middleware) --
cookies: Record<string, string> = {};

// -- Session (filled by session middleware, persisted to signed cookie) --
session: Record<string, unknown> = {};
```

### 3. Controller Helpers (`src/blaze/controller.ts`)

Three flash-related helpers:

```typescript
export function putFlash(ctx: Context, key: string, message: string): Context {
  const flash = (ctx.session._flash ?? {}) as Record<string, string>;
  flash[key] = message;
  ctx.session._flash = flash;
  return ctx;
}

export function getFlash(ctx: Context): Record<string, string> {
  return (ctx.getPrivate("flash") ?? {}) as Record<string, string>;
}

export function getFlashKey(ctx: Context, key: string): string | undefined {
  return getFlash(ctx)[key];
}
```

The flash lifecycle:
1. `putFlash(ctx, "info", "Saved!")` — stores in `session._flash`
2. Session is encoded into the Set-Cookie header
3. On next request, `_flash` is **popped** from session → moved to `ctx.private.flash`
4. `getFlash(ctx)` reads from private (current request only)
5. Since `_flash` was deleted from session, it won't appear again

### 4. Server Integration (`src/blaze/server.ts`)

Session decode/encode wraps the router pipeline:

```typescript
// Before routing:
ctx.cookies = Session.parseCookies(headers["cookie"] ?? "");
const rawSession = Session.decode(ctx.cookies[Session.cookieName()]);
const flash = rawSession._flash ?? {};
delete rawSession._flash;
ctx.session = rawSession;
ctx.putPrivate("flash", flash);

// After routing:
const sessionCookie = Session.encode(ctx.session);
ctx.setHeader("set-cookie",
  `${Session.cookieName()}=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`);
```

## How It Works

```
POST /flash/send
  ├─ Body parsed: { type: "info", message: "Hello!" }
  ├─ putFlash(ctx, "info", "Hello!")
  │    → ctx.session._flash = { info: "Hello!" }
  ├─ redirect(ctx, "/flash")
  │    → Set-Cookie: _blaze_session=<base64>.hmac
  └─ 302 Location: /flash

GET /flash (with cookie)
  ├─ Session.decode(cookie) → { _flash: { info: "Hello!" } }
  ├─ Pop flash: ctx.private.flash = { info: "Hello!" }
  │             delete session._flash
  ├─ getFlash(ctx) → { info: "Hello!" }  ← available this request
  ├─ Render page with green flash box
  └─ Set-Cookie: _blaze_session=<base64>.hmac  ← no _flash

GET /flash (next request)
  ├─ Session.decode(cookie) → {}  ← no flash
  └─ Flash is gone — one-shot behavior ✓
```

## Try It Out

```bash
# Start the server
npx tsx src/app.ts

# 1. Visit /flash — no flash messages, visit count starts at 1
curl -s http://localhost:4001/flash | grep "Session visits"

# 2. POST to set a flash message, capture the cookie
COOKIE=$(curl -s -D - -X POST http://localhost:4001/flash/send \
  -d "type=info&message=Hello+from+flash!" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | grep -i set-cookie | sed 's/.*_blaze_session=//' | sed 's/;.*//')

# 3. Follow redirect with cookie — flash appears!
curl -s -b "_blaze_session=$COOKIE" http://localhost:4001/flash | grep "Hello"
# → Shows green info box with "Hello from flash!"

# 4. Request again — flash is gone (one-shot)
# (would need new cookie from step 3's response)
```

Or just open http://localhost:4001/flash in a browser, fill the form, and submit.

## File Checklist

| File | Status | Purpose |
|---|---|---|
| `src/blaze/session.ts` | **New** | Cookie parsing, HMAC-SHA256 encode/decode |
| `src/blaze/context.ts` | Modified | Added `cookies` and `session` fields |
| `src/blaze/controller.ts` | Modified | Added `putFlash`, `getFlash`, `getFlashKey` |
| `src/blaze/server.ts` | Modified | Session decode/encode around router pipeline |
| `src/app.ts` | Modified | `/flash` demo routes with visit counter |

## What's Next

**Step 30 — Presence Tracking:** An in-memory presence system that tracks connected users, broadcasts joins/leaves, and auto-cleans on WebSocket close — the "Who's Online" feature.
