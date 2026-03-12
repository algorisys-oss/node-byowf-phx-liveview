[← Step 42: Cluster Mode](42-cluster-mode.md)

# Step 43 — Single Executable Application

## What We're Building

A standalone Blaze binary using Node.js Single Executable Applications (SEA). The entire framework + app gets bundled into one file and injected into the Node.js binary — deploy by copying a single file.

## Concepts You'll Learn

- **Node.js SEA** — embedding JavaScript into the Node.js binary itself
- **Code bundling** — combining all modules into one JS file with esbuild
- **postject** — injecting resources into executables
- **Binary distribution** — shipping a single file instead of `node_modules/`

## How It Works

### Build Pipeline

```
TypeScript sources         Bundle              SEA Blob            Binary
  src/app.ts        →  dist/app.mjs    →  sea-prep.blob    →  dist/blaze
  src/blaze/*.ts       (one JS file)      (V8 code cache)     (standalone)
  src/my_app/*.ts
```

### Step by Step

1. **Bundle**: esbuild compiles all TypeScript into a single `app.mjs`
2. **SEA Config**: `sea-config.json` tells Node.js how to prepare the blob
3. **Generate Blob**: `node --experimental-sea-config` creates `sea-prep.blob`
4. **Inject**: `postject` embeds the blob into a copy of the Node.js binary
5. **Result**: `./dist/blaze` runs without `node`, `npm`, or `node_modules/`

### SEA Limitations

| Works | Doesn't Work |
|-------|-------------|
| Pure JS/TS code | Native modules (better-sqlite3) |
| HTTP server (uWS is bundled) | Dynamic `import()` at runtime |
| WebSocket handlers | `require()` of non-bundled files |
| Template strings | `readFileSync` of source files |
| In-memory PubSub | File-based templates |

For production use with native modules, consider Docker containers instead of SEA.

## The Code

### `scripts/build-sea.sh` (new)

```bash
#!/bin/bash
# 1. Bundle with esbuild
npx esbuild src/app.ts --bundle --platform=node --target=node22 \
  --format=esm --outfile=dist/app.mjs \
  --external:uWebSockets.js --external:better-sqlite3

# 2. Create SEA config
cat > dist/sea-config.json << EOF
{
  "main": "app.mjs",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true
}
EOF

# 3. Generate blob
node --experimental-sea-config dist/sea-config.json

# 4. Inject into Node.js binary
cp $(which node) dist/blaze
npx postject dist/blaze NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

## Try It Out

```bash
# Install build dependencies
npm install -D esbuild postject

# Build the SEA binary
bash scripts/build-sea.sh

# Run the standalone binary
./dist/blaze
```

**Note**: Due to native module dependencies (uWebSockets.js, better-sqlite3), the full SEA binary requires those `.node` files alongside it. For a completely standalone deployment, use Docker:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
COPY public/ public/
COPY templates/ templates/
CMD ["npx", "tsx", "src/app.ts"]
```

## Alternative: Docker Deployment

For production deployments with native modules, Docker is the recommended approach:

```bash
# Build
docker build -t blaze .

# Run
docker run -p 4001:4001 blaze
```

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `scripts/build-sea.sh` | **New** | SEA build script (bundle + blob + inject) |

## The Journey So Far

From a bare `node:http` server to a full Phoenix-like framework:

- **43 steps** covering HTTP, routing, middleware, WebSockets, LiveView, PubSub, components, streams, uploads, presence, SQLite, CSRF, CSP, logging, testing, SSL, rate limiting, clustering, and packaging
- **Zero external dependencies** for the first 13 steps
- **uWebSockets.js** for HTTP + WebSocket on one port
- **better-sqlite3** for synchronous SQLite
- **node:test** for built-in testing

Blaze is complete.

[← Step 42: Cluster Mode](42-cluster-mode.md)
