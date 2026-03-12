# Step 8: POST Body Parser

[← Previous: Step 7 - Middleware Pipeline](07-middleware-pipeline.md) | [Next: Step 9 - Full HTTP Methods →](09-full-http-methods.md)

---

## What We're Building

So far, our framework only handles GET requests -- reading data from URLs.
Real web applications need to accept **user input**: form submissions,
JSON API payloads, and file uploads.

In this step, we add:

1. **`parseBody()`** method on Context to read and parse request bodies
2. **`post()`** route registration on Router
3. Support for `application/x-www-form-urlencoded` (HTML forms) and
   `application/json` (API clients)

### How This Compares to Ignite (Elixir)

In the Elixir version, the parser module reads the request body from the
TCP socket and decodes it based on the `Content-Type` header:

- URL-encoded: `URI.decode_query(body)` → map
- JSON: `Jason.decode!(body)` → map

The parsed body goes into `conn.params`, merged with URL params.

In Blaze, we manually collect chunks from Node.js's `IncomingMessage`
stream and parse the accumulated buffer. The parsed body goes into
`ctx.body` as a separate field from `ctx.params`.

## Concepts You'll Learn

### Request Bodies

When a browser submits a form or JavaScript sends a `fetch()` POST, the
data is sent in the **request body**. The `Content-Type` header tells the
server how to decode it:

| Content-Type | Format | Example |
|---|---|---|
| `application/x-www-form-urlencoded` | key=value&key=value | `name=Alice&age=30` |
| `application/json` | JSON string | `{"name":"Alice","age":30}` |
| `multipart/form-data` | Binary boundaries | (file uploads -- later step) |

### Reading the Body in Node.js

Unlike Bun (which has `req.json()` / `req.text()` from the Web Standard
`Request` API), Node.js's `IncomingMessage` is a **readable stream**. You
must collect data chunks and concatenate them:

```typescript
private readBody(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    this.req.on("data", (chunk: Buffer) => chunks.push(chunk));
    this.req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    this.req.on("error", reject);
  });
}
```

This is the fundamental Node.js streaming pattern:
1. Listen for `"data"` events -- each fires with a `Buffer` chunk
2. Collect chunks into an array
3. On `"end"`, concatenate all chunks into a single string
4. On `"error"`, reject the promise

### URL-Encoded Forms

HTML `<form>` elements submit data as URL-encoded by default:

```html
<form method="POST" action="/users">
  <input name="name" value="Alice">
  <input name="email" value="alice@example.com">
</form>
```

This sends: `name=Alice&email=alice%40example.com`

We parse it using the Web Standard `URLSearchParams`:

```typescript
const params = new URLSearchParams(text);
// params.get("name") → "Alice"
```

### JSON Bodies

API clients (and JavaScript `fetch()`) typically send JSON:

```typescript
fetch("/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Alice", age: 30 }),
});
```

We parse it using `JSON.parse()` on the collected body text.

### Body Parsing as Middleware

Body parsing runs as middleware -- before route handlers. This means
every POST/PUT/PATCH handler can access `ctx.body` without calling
`parseBody()` manually:

```typescript
router.use((ctx) => {
  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    return ctx.parseBody();
  }
  return ctx;
});
```

### `ctx.body` vs `ctx.params`

- **`ctx.params`** -- URL parameters from dynamic routes (`/users/:id`)
- **`ctx.body`** -- Parsed request body from POST/PUT/PATCH

In Phoenix, both are merged into `conn.params`. In Blaze, they're
separate for clarity. You always know where the data came from.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (Ignite) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Read body | `:gen_tcp.recv` | `req.text()` / `req.json()` | `req.on("data"/"end")` chunks |
| Parse form | `URI.decode_query(body)` | `new URLSearchParams(text)` | `new URLSearchParams(text)` |
| Parse JSON | `Jason.decode!(body)` | `req.json()` | `JSON.parse(text)` |
| Storage | `conn.params` (merged) | `ctx.body` (separate) | `ctx.body` (separate) |
| Trigger | Parser module (always) | Middleware (POST/PUT/PATCH) | Middleware (POST/PUT/PATCH) |
| Stream model | Single read from socket | Web Standard Request | Node.js Readable stream |

## The Code

### `src/blaze/context.ts` -- Updated with Body Parsing

```typescript
export class Context {
  // ... existing fields ...

  // -- Request body (filled by parseBody()) --
  body: Record<string, unknown> = {};

  // ... constructor and existing methods ...

  // -- Body parsing --

  private readBody(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.req.on("data", (chunk: Buffer) => chunks.push(chunk));
      this.req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      this.req.on("error", reject);
    });
  }

  async parseBody(): Promise<this> {
    const contentType = (this.headers["content-type"] as string) ?? "";

    if (contentType.includes("application/json")) {
      try {
        const text = await this.readBody();
        this.body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        this.body = {};
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await this.readBody();
      const params = new URLSearchParams(text);
      const parsed: Record<string, unknown> = {};
      for (const [key, value] of params) {
        parsed[key] = value;
      }
      this.body = parsed;
    }

    return this;
  }

  // ... rest unchanged ...
}
```

**Key decisions:**

- **`readBody()` is private:** Only used internally by `parseBody()`.
  It wraps the Node.js streaming pattern in a Promise.
- **`body` is a separate field:** Not merged with `params`. URL params
  and body params have different sources and semantics.
- **`parseBody()` returns `this`:** Chainable and works as middleware
  (returns the context).
- **`try/catch` on JSON:** Invalid JSON doesn't crash the server -- it
  falls back to an empty object.
- **Content-type sniffing:** Uses `includes()` instead of exact match
  to handle charsets like `application/json; charset=utf-8`.
- **Only two content types:** Form-encoded and JSON. Multipart (file
  uploads) is handled in a later step.

### `src/blaze/router.ts` -- Added `post()`

```typescript
post(path: string, handler: Handler): this {
  this.routes.push({ method: "POST", path, segments: splitPath(path), handler });
  return this;
}
```

Same pattern as `get()`, different HTTP method.

### `src/app.ts` -- Body Parsing Middleware + Demo

```typescript
// Middleware: parse request body for POST/PUT/PATCH
router.use((ctx) => {
  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    return ctx.parseBody();
  }
  return ctx;
});

// GET route: form to test POST
router.get("/echo", (ctx) =>
  html(ctx, `<h1>Echo POST</h1>
<h2>Form (URL-encoded)</h2>
<form method="POST" action="/echo">
  <label>Name: <input name="name" value="Alice"></label><br><br>
  <label>Email: <input name="email" value="alice@example.com"></label><br><br>
  <button type="submit">Submit Form</button>
</form>
<h2>JSON (via fetch)</h2>
<button onclick="sendJson()">Send JSON</button>
<pre id="result"></pre>
<script>
async function sendJson() {
  const res = await fetch("/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", age: 30, admin: false })
  });
  const data = await res.json();
  document.getElementById("result").textContent = JSON.stringify(data, null, 2);
}
</script>`),
);

// POST route: echo back the parsed body
router.post("/echo", (ctx) => json(ctx, { received: ctx.body }));
```

The `/echo` route has both a GET (shows the form) and POST (echoes the
parsed body) handler.

## How It Works

### Form Submission

```
Browser submits form:
  POST /echo
  Content-Type: application/x-www-form-urlencoded
  Body: name=Alice&email=alice%40example.com

Middleware: parseBody()
  1. Content-Type includes "x-www-form-urlencoded"
  2. readBody() → collect chunks → "name=Alice&email=alice%40example.com"
  3. new URLSearchParams(text) → iterate key/value pairs
  4. ctx.body = { name: "Alice", email: "alice@example.com" }

Handler: json(ctx, { received: ctx.body })
  → {"received":{"name":"Alice","email":"alice@example.com"}}
```

### JSON API Call

```
JavaScript sends:
  POST /echo
  Content-Type: application/json
  Body: {"name":"Bob","age":30}

Middleware: parseBody()
  1. Content-Type includes "application/json"
  2. readBody() → collect chunks → '{"name":"Bob","age":30}'
  3. JSON.parse(text) → { name: "Bob", age: 30 }
  4. ctx.body = { name: "Bob", age: 30 }

Handler: json(ctx, { received: ctx.body })
  → {"received":{"name":"Bob","age":30}}
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the echo form

Go to http://localhost:4001/echo

You'll see a form with Name and Email fields, and a "Send JSON" button.

### 3. Submit the form

Click "Submit Form" -- the response will show the parsed form data as JSON.

### 4. Send JSON

Click "Send JSON" -- the response shows the parsed JSON body in the `<pre>` area.

### 5. Test with curl

```bash
# URL-encoded form
curl -X POST http://localhost:4001/echo \
  -d "name=Alice&email=alice@example.com"
# {"received":{"name":"Alice","email":"alice@example.com"}}

# JSON body
curl -X POST http://localhost:4001/echo \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","age":30}'
# {"received":{"name":"Bob","age":30}}

# Empty body
curl -X POST http://localhost:4001/echo
# {"received":{}}
```

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/context.ts` | **Modified** | Added `body` field, `readBody()`, and `parseBody()` method |
| `src/blaze/router.ts` | **Modified** | Added `post()` method |
| `src/app.ts` | **Modified** | Body parsing middleware, GET/POST echo routes |

---

[← Previous: Step 7 - Middleware Pipeline](07-middleware-pipeline.md) | [Next: Step 9 - Full HTTP Methods →](09-full-http-methods.md)

## What's Next

We have `get()` and `post()`, but real REST APIs need all HTTP methods.
In **Step 9**, we'll add **Full HTTP Methods** -- `put()`, `patch()`,
and `delete()` route registration.
