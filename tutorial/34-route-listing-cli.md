# Step 34 — Route Listing CLI

## What We're Building

A CLI tool that prints all registered routes — both HTTP and LiveView — in a formatted table. Equivalent to `mix phx.routes` in Phoenix. Run it with `npm run routes`.

## Concepts You'll Learn

- **CLI scripts** — standalone TypeScript entry points run via `npx tsx`
- **Module-level guards** — conditionally starting the server based on `process.argv`
- **Re-exporting state** — making router and liveRoutes importable from `app.ts`

## How It Works

### The Challenge

`app.ts` defines all routes AND starts the server. The CLI needs the routes but NOT the server. Solution: export the router and liveRoutes, and guard `serve()` so it only runs when `app.ts` is the entry point:

```typescript
// app.ts
export const router = new Router();
export const liveRoutes = new Map([...]);

// Only start server when app.ts is the entry point
const isMain = process.argv[1]?.endsWith("app.ts");
if (isMain) {
  serve({ port: 4001, router, liveRoutes });
}
```

Now `import { router, liveRoutes } from "../app.js"` gives the CLI access to routes without starting the server.

## The Code

### `src/cli/routes.ts` (new)

```typescript
#!/usr/bin/env npx tsx
import { router, liveRoutes } from "../app.js";

console.log("\n  Blaze Routes");
console.log("  " + "=".repeat(65));

// LiveView routes
const liveEntries = [...liveRoutes.keys()];
if (liveEntries.length > 0) {
  console.log("\n  LiveView:");
  for (const path of liveEntries) {
    console.log(`    ${"GET".padEnd(8)} ${path.padEnd(30)} [LiveView/WebSocket]`);
  }
}

// HTTP routes
const httpRoutes = router.getRoutes();
if (httpRoutes.length > 0) {
  console.log("\n  HTTP:");
  for (const r of httpRoutes) {
    const name = r.name ? `(${r.name})` : "";
    console.log(`    ${r.method.padEnd(8)} ${r.path.padEnd(30)} ${name}`);
  }
}

const total = liveEntries.length + httpRoutes.length;
console.log(`\n  Total: ${liveEntries.length} LiveView + ${httpRoutes.length} HTTP = ${total} routes\n`);
```

### Changes to `src/app.ts`

- `const router` → `export const router`
- `const liveRoutes` → `export const liveRoutes`
- `serve(...)` → guarded with `process.argv[1]?.endsWith("app.ts")` check

## Try It Out

```bash
npm run routes
```

Output:
```
  Blaze Routes
  =================================================================

  LiveView:
    GET      /counter                       [LiveView/WebSocket]
    GET      /dashboard                     [LiveView/WebSocket]
    GET      /shared-counter                [LiveView/WebSocket]
    ...

  HTTP:
    GET      /
    GET      /hello                         (hello)
    GET      /api/status                    (api_status)
    POST     /echo
    ...

  Total: 10 LiveView + 18 HTTP = 28 routes
```

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/cli/routes.ts` | **New** | Route listing CLI tool |
| `src/app.ts` | Modified | Exported router/liveRoutes, guarded serve() |
| `package.json` | Modified | Added `routes` npm script |

## What's Next

**Step 35 — Debug Error Page:** A rich development error page with stack traces, source code preview, and request context — like Phoenix's debug error page.
