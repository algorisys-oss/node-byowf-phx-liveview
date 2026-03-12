[← Step 36: Logger & Request ID](36-logger-request-id.md) | [Step 38: Test Helpers →](38-test-helpers.md)

# Step 37 — Static Asset Pipeline

## What We're Building

Content-hashed static asset URLs for cache busting. At server boot, we compute MD5 hashes of all files in `public/`, then `staticPath("blaze.js")` returns `/public/blaze.js?v=cc993a90`. The browser caches versioned URLs for 1 year; when the file changes, the hash changes, forcing a fresh download.

## Concepts You'll Learn

- **Content-based hashing** — deriving cache keys from file contents, not timestamps
- **Cache busting** — appending `?v=HASH` to URLs so browsers fetch fresh files on change
- **Immutable caching** — `Cache-Control: immutable` tells browsers to never revalidate
- **Boot-time manifest** — hashing files once at startup for zero-cost lookups

## How It Works

### The Problem

Without cache busting, browsers may serve stale JavaScript/CSS after a deploy:
```
Deploy v1: browser caches /public/blaze.js (old version)
Deploy v2: server has new blaze.js, but browser serves cached v1
User sees bugs from stale JS!
```

### The Solution

```
Boot time:
  → Read all files in public/
  → MD5 hash each file → first 8 hex chars
  → Store in memory: { "blaze.js" → "cc993a90" }

Request for /counter:
  → staticPath("blaze.js") → "/public/blaze.js?v=cc993a90"
  → Browser sees new URL → fetches fresh file
  → Server responds with Cache-Control: immutable

After code deploy:
  → Server reboots, re-hashes files
  → blaze.js changed → new hash "d4e5f6a7"
  → staticPath("blaze.js") → "/public/blaze.js?v=d4e5f6a7"
  → Browser doesn't have this URL cached → fetches fresh copy
```

### Why Query String (not Filename Fingerprinting)?

| Approach | Pros | Cons |
|----------|------|------|
| Filename: `blaze-cc993a90.js` | CDN-friendly, optimal | Requires build step, manifest file |
| **Query: `blaze.js?v=cc993a90`** | No build step, simple | Some CDNs ignore query strings |

We use query strings because: no build tools needed, hashes computed at boot, works with our existing file server.

## The Code

### `src/blaze/static.ts` (new)

```typescript
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const manifest = new Map<string, string>();

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export function buildManifest(publicDir: string): void {
  manifest.clear();
  try {
    statSync(publicDir);
  } catch {
    return; // Directory doesn't exist, nothing to hash
  }
  for (const filePath of walkDir(publicDir)) {
    const rel = relative(publicDir, filePath);
    manifest.set(rel, hashFile(filePath));
  }
}

export function staticPath(filename: string): string {
  const hash = manifest.get(filename);
  return hash ? `/public/${filename}?v=${hash}` : `/public/${filename}`;
}
```

### Changes to `src/blaze/server.ts`

1. **Boot**: `buildManifest(PUBLIC_DIR)` before starting the server
2. **Cache headers**: When serving static files with `?v=`, set `Cache-Control: public, max-age=31536000, immutable`
3. **LiveView page**: Script tags now use `staticPath()` for versioned URLs

### Changes to `src/blaze/controller.ts`

Re-exports `staticPath` for use in route handlers.

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/counter` — view page source:
   ```html
   <script src="/public/morphdom.min.js?v=0b337db4"></script>
   <script src="/public/hooks.js?v=82b1b4c4"></script>
   <script src="/public/blaze.js?v=cc993a90"></script>
   ```
2. Check cache headers:
   ```bash
   # Without version — no cache header
   curl -sD - -o /dev/null http://localhost:4001/public/blaze.js | grep cache

   # With version — immutable cache for 1 year
   curl -sD - -o /dev/null "http://localhost:4001/public/blaze.js?v=cc993a90" | grep cache
   # cache-control: public, max-age=31536000, immutable
   ```
3. Edit `public/blaze.js` slightly, restart server — the hash changes

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/static.ts` | **New** | Content-hashed manifest, `staticPath()`, `buildManifest()` |
| `src/blaze/server.ts` | Modified | Build manifest at boot, cache headers, versioned LiveView scripts |
| `src/blaze/controller.ts` | Modified | Re-exports `staticPath` |

## What's Next

**Step 38 — Test Helpers:** `buildContext()`, `get()`/`post()` test helpers, assertions, `node:test` runner.

[← Step 36: Logger & Request ID](36-logger-request-id.md) | [Step 38: Test Helpers →](38-test-helpers.md)
