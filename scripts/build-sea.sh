#!/bin/bash
# Build a Node.js Single Executable Application (SEA)
#
# Prerequisites:
#   1. Node.js v21+ (SEA support)
#   2. The app must be bundled into a single JS file first
#
# Usage: bash scripts/build-sea.sh
#
# SEA Limitations:
#   - No native modules (better-sqlite3 won't work in SEA)
#   - Must bundle all code into one JS file
#   - No dynamic require() / import()
#   - File system paths are relative to the binary location

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/dist"

echo "=== Blaze SEA Builder ==="
echo ""

# Step 1: Bundle TypeScript into a single JS file
echo "[1/4] Bundling TypeScript..."
mkdir -p "$BUILD_DIR"

# Use esbuild if available, otherwise fall back to tsx compilation
if command -v npx &> /dev/null && npx esbuild --version &> /dev/null 2>&1; then
  npx esbuild "$PROJECT_DIR/src/app.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile="$BUILD_DIR/app.mjs" \
    --external:uWebSockets.js \
    --external:better-sqlite3
  echo "  → Bundled to dist/app.mjs"
else
  echo "  ⚠ esbuild not found. Install with: npm install -D esbuild"
  echo "  Falling back to simple copy (won't work for SEA without bundling)"
  cp "$PROJECT_DIR/src/app.ts" "$BUILD_DIR/app.ts"
fi

# Step 2: Create SEA config
echo "[2/4] Creating SEA config..."
cat > "$BUILD_DIR/sea-config.json" << 'SEAEOF'
{
  "main": "app.mjs",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
SEAEOF
echo "  → Created dist/sea-config.json"

# Step 3: Generate the SEA blob
echo "[3/4] Generating SEA blob..."
cd "$BUILD_DIR"
node --experimental-sea-config sea-config.json 2>&1 || {
  echo ""
  echo "  ⚠ SEA blob generation failed."
  echo "  This requires Node.js v21+ with SEA support."
  echo "  Current Node.js: $(node --version)"
  exit 1
}
echo "  → Generated sea-prep.blob"

# Step 4: Inject into Node.js binary
echo "[4/4] Injecting blob into binary..."
NODE_BIN=$(which node)
BLAZE_BIN="$BUILD_DIR/blaze"

cp "$NODE_BIN" "$BLAZE_BIN"

# Use postject to inject the SEA blob
npx postject "$BLAZE_BIN" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 2>&1 || {
  echo ""
  echo "  ⚠ Postject failed. Install with: npm install -D postject"
  exit 1
}

echo ""
echo "=== Build Complete ==="
echo "  Binary: $BLAZE_BIN"
echo "  Size:   $(du -h "$BLAZE_BIN" | cut -f1)"
echo ""
echo "  Run with: ./dist/blaze"
