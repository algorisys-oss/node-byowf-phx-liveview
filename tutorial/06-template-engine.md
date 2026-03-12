# Step 6: Template Engine

[← Previous: Step 5 - Dynamic Routes](05-dynamic-routes.md) | [Next: Step 7 - Middleware Pipeline →](07-middleware-pipeline.md)

---

## What We're Building

So far, all our HTML has been inline strings in route handlers. That works
for small responses, but real web applications have full HTML pages with
layouts, dynamic data, and reusable partials.

In this step, we build a **template engine** that:

1. Loads HTML templates from the `templates/` directory
2. Interpolates dynamic values using `${assigns.name}` syntax
3. Caches templates in memory for performance
4. Integrates with a `render()` controller helper

### How This Compares to Ignite (Elixir)

In Elixir, templates use **EEx** (Embedded Elixir) -- a standard library
feature that embeds Elixir expressions in `<%= @name %>` tags:

```elixir
<h1>Hello, <%= @name %>!</h1>
```

The `render/3` helper loads the template file, evaluates it with assigns,
and sets the HTML response:

```elixir
render(conn, "profile", name: "Alice", id: 42)
```

In Blaze, we use JavaScript's **template literal** syntax. Templates are
HTML files containing `${assigns.name}` expressions, evaluated at runtime
with `new Function()`. The `render()` helper works the same way.

## Concepts You'll Learn

### Template Literals as a Template Engine

JavaScript template literals (backtick strings) already support
`${expression}` interpolation. Our engine leverages this by wrapping
template file contents in backticks and evaluating them as a function:

```typescript
const fn = new Function("assigns", "`" + templateSource + "`");
const html = fn({ name: "Alice" });
```

This turns any HTML file with `${assigns.name}` into a working template.

### Assigns Pattern

Templates receive data through an `assigns` object -- the same pattern
Phoenix uses. In the template:

```html
<h1>${assigns.name}</h1>
<p>Email: ${assigns.email}</p>
```

In the handler:

```typescript
render(ctx, "profile", { name: "Alice", email: "alice@example.com" })
```

### Template Caching

Reading files from disk on every request would be slow. We cache template
source text in a `Map` after the first read. In development, you can call
`clearTemplateCache()` to pick up changes (or just restart with
`npx tsx --watch`).

### File-Based Templates

Templates live in the `templates/` directory with a `.html` extension:

```
templates/
├── profile.html
├── layout.html    (added in later steps)
└── ...
```

### __dirname in ESM

In CommonJS Node.js, `__dirname` is a global. In ESM (`"type": "module"`),
it doesn't exist. We reconstruct it from `import.meta.url`:

```typescript
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
```

This is the standard pattern for ESM modules in Node.js. The Bun version
uses `import.meta.dir` which is a Bun-specific shortcut.

### Security Note

Using `new Function()` to evaluate templates means template files can
execute arbitrary JavaScript. This is fine because **templates are authored
by the developer, not by users**. User input flows through `assigns` values,
not template source. However, assigns values are interpolated as raw strings
-- we'll add HTML escaping when we build the LiveView engine later.

### Comparison: Elixir vs Bun vs Node.js

| Concept | Elixir (EEx) | Bun (Blaze) | Node.js (Blaze) |
|---|---|---|---|
| Syntax | `<%= @name %>` | `${assigns.name}` | `${assigns.name}` |
| File extension | `.html.eex` | `.html` | `.html` |
| Evaluation | `EEx.eval_file/2` | `new Function(...)` | `new Function(...)` |
| File reading | `File.read!/1` | `Bun.file(path).text()` | `readFile(path, "utf-8")` |
| Dir resolution | `__DIR__` | `import.meta.dir` | `dirname(fileURLToPath(import.meta.url))` |
| Caching | Compiled at load time | `Map` cache | `Map` cache |
| Render helper | `render(conn, "tpl", name: "A")` | `render(ctx, "tpl", { name: "A" })` | `render(ctx, "tpl", { name: "A" })` |
| Control flow | `<%= if @show do %>...` | `${assigns.show ? "..." : ""}` | `${assigns.show ? "..." : ""}` |

## The Code

### `src/blaze/template.ts` -- The Template Engine

```typescript
/**
 * Blaze Template Engine -- File-based HTML templates.
 *
 * Equivalent to EEx templates in the Elixir version.
 * Templates use ${assigns.name} interpolation inside backtick strings.
 * Files are loaded from the templates/ directory.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const templateCache = new Map<string, string>();

const __dirname = dirname(fileURLToPath(import.meta.url));

function templateDir(): string {
  return join(__dirname, "..", "..", "templates");
}

export async function renderTemplate(
  name: string,
  assigns: Record<string, unknown> = {},
): Promise<string> {
  let source = templateCache.get(name);

  if (!source) {
    const path = join(templateDir(), `${name}.html`);

    try {
      source = await readFile(path, "utf-8");
    } catch {
      throw new Error(`Template not found: ${path}`);
    }

    templateCache.set(name, source);
  }

  // Evaluate template: replace ${...} expressions with assigns values
  const fn = new Function("assigns", `return \`${source}\`;`);
  return fn(assigns) as string;
}

export function clearTemplateCache(): void {
  templateCache.clear();
}
```

**Key decisions:**

- **`__dirname` reconstruction:** ESM doesn't have `__dirname`. We derive
  it from `import.meta.url` using `fileURLToPath` + `dirname`. This is
  the standard Node.js ESM pattern.
- **`readFile()` from `node:fs/promises`:** Async file reading. Unlike
  Bun's `Bun.file(path).text()`, Node.js uses the traditional fs API.
- **`new Function()`:** Creates a function that evaluates the template
  source as a template literal. The `assigns` parameter is the only
  variable in scope, preventing accidental access to other variables.
- **Cache invalidation:** `clearTemplateCache()` is provided for dev use.
  In production, templates are cached forever (they don't change).
- **`.html` extension:** Simpler than `.html.eex`. The file IS HTML -- it
  just happens to have `${...}` expressions in it.

### `src/blaze/controller.ts` -- Updated with `render()`

```typescript
import type { Context } from "./context.js";
import { renderTemplate } from "./template.js";

// ... existing helpers (text, html, json, redirect) ...

export async function render(
  ctx: Context,
  template: string,
  assigns: Record<string, unknown> = {},
): Promise<Context> {
  const body = await renderTemplate(template, assigns);
  return html(ctx, body);
}
```

The `render()` helper loads and evaluates the template, then delegates to
`html()` to set the response. It's async because file reading is async.

### `templates/profile.html` -- Example Template

```html
<!DOCTYPE html>
<html>
<head><title>${assigns.name} — Blaze</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  h1 { color: #e45; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
  .label { font-weight: bold; color: #666; }
  a { color: #36c; }
</style>
</head>
<body>
  <h1>User Profile</h1>
  <div class="card">
    <p><span class="label">ID:</span> ${assigns.id}</p>
    <p><span class="label">Name:</span> ${assigns.name}</p>
    <p><span class="label">Email:</span> ${assigns.email}</p>
  </div>
  <p><a href="/">← Back to home</a></p>
</body>
</html>
```

### `src/app.ts` -- New Template Route

```typescript
router.get("/profile/:id", (ctx) =>
  render(ctx, "profile", {
    id: ctx.params.id,
    name: `User ${ctx.params.id}`,
    email: `user${ctx.params.id}@example.com`,
  }),
);
```

The handler extracts the `:id` param (Step 5), builds an assigns object,
and renders the `profile` template.

## How It Works

```
Request: GET /profile/42

Router matches /profile/:id  →  ctx.params = { id: "42" }

Handler calls:
  render(ctx, "profile", { id: "42", name: "User 42", email: "user42@..." })

  renderTemplate("profile", assigns):
    1. Check cache: miss
    2. readFile("templates/profile.html", "utf-8")
    3. Cache the source
    4. new Function("assigns", "`...template source...`")
    5. Call fn(assigns) → HTML string with values interpolated

  html(ctx, renderedHTML):
    1. ctx.setStatus(200)
    2. ctx.setHeader("content-type", "text/html; charset=utf-8")
    3. ctx.setBody(renderedHTML)
    4. ctx.halt()

Response: 200 OK with rendered profile page
```

## Try It Out

### 1. Start the server

```bash
npx tsx src/app.ts
```

### 2. Visit the template route

Go to http://localhost:4001/profile/42

You should see a styled profile card with:
- ID: 42
- Name: User 42
- Email: user42@example.com

### 3. Try different IDs

- http://localhost:4001/profile/1
- http://localhost:4001/profile/99

Each shows different data from the same template.

### 4. Create your own template

Create `templates/greeting.html`:

```html
<h1>Hello, ${assigns.name}!</h1>
<p>Today is ${assigns.date}.</p>
```

Add a route in `src/app.ts`:

```typescript
router.get("/greetpage/:name", (ctx) =>
  render(ctx, "greeting", {
    name: ctx.params.name,
    date: new Date().toLocaleDateString(),
  }),
);
```

### 5. Template expressions

You can use any JavaScript expression in `${...}`:

```html
<!-- Conditional -->
<p>${assigns.admin ? "Admin User" : "Regular User"}</p>

<!-- Array -->
<ul>${assigns.items.map(i => `<li>${i}</li>`).join("")}</ul>

<!-- Computation -->
<p>Total: $${(assigns.price * assigns.quantity).toFixed(2)}</p>
```

### 6. Type check

```bash
npx tsc --noEmit
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `src/blaze/template.ts` | **New** | Template engine with file loading, caching, interpolation |
| `src/blaze/controller.ts` | **Modified** | Added `render()` helper |
| `templates/profile.html` | **New** | Example user profile template |
| `src/app.ts` | **Modified** | Added `/profile/:id` route, updated landing page |

---

[← Previous: Step 5 - Dynamic Routes](05-dynamic-routes.md) | [Next: Step 7 - Middleware Pipeline →](07-middleware-pipeline.md)

## What's Next

We have routing, response helpers, and templates. In **Step 7**, we'll
build a **Middleware Pipeline** -- composable functions that run before
every request (logging, authentication, CORS), with support for halting
the pipeline. This is the equivalent of Phoenix's Plug pipeline.
