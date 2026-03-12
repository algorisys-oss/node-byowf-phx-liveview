# Step 0: Project Setup

[Next: Step 1 - HTTP Server →](01-http-server.md)

---

## What We're Building

Before writing any framework code, we need to create the project that
will hold everything. By the end of this step, you'll have a working
Node.js + TypeScript project called **Blaze** that runs.

## Prerequisites

- **Node.js >= 22** installed. Check with:
  ```bash
  node --version
  ```
  If not installed, follow the [official guide](https://nodejs.org/).

- **A text editor** -- VS Code with the TypeScript extension works well.

- **A terminal** -- all commands in this tutorial use bash.

## Concepts You'll Learn

### Node.js

**Node.js** is the most widely deployed JavaScript runtime. Unlike Bun,
Node.js doesn't run TypeScript directly -- we use **tsx** as our
TypeScript executor. tsx uses esbuild under the hood for near-instant
transpilation.

Key characteristics:
- Runs on V8 (Chrome's JavaScript engine)
- Vast `node:*` standard library (http, fs, crypto, streams, etc.)
- Single-threaded event loop with async I/O
- `node:http` for HTTP servers (no framework needed)
- TypeScript via tsx (zero-config, fast)

### tsx

**tsx** (TypeScript Execute) is a zero-config TypeScript runner for Node.js.
It lets you run `.ts` files directly, just like Bun does natively:

```bash
npx tsx src/app.ts        # Run once
npx tsx --watch src/app.ts  # Run with auto-restart on file changes
```

Under the hood, tsx uses esbuild to transpile TypeScript to JavaScript
on-the-fly. It's a dev dependency only -- it doesn't ship with your
production code.

### Project Structure

Our project layout mirrors Phoenix/Ignite:

```
blaze/
├── src/                  # Source code
│   ├── blaze/            # Framework core (like lib/ignite/ in Elixir)
│   └── app.ts            # Application entry point
├── public/               # Client-side JS/CSS
├── templates/            # HTML templates
├── tutorial/             # Step-by-step docs
├── tests/                # Test files
├── package.json          # Project config (like mix.exs)
├── tsconfig.json         # TypeScript config
└── README.md
```

### package.json

This is the project's configuration file (equivalent to Elixir's `mix.exs`):

```json
{
  "name": "blaze",
  "version": "0.0.0",
  "type": "module",
  "main": "src/app.ts",
  "scripts": {
    "dev": "npx tsx --watch src/app.ts",
    "start": "npx tsx src/app.ts",
    "test": "node --test tests/**/*.test.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

Key parts:
- **`name`** -- project name
- **`type: "module"`** -- use ES modules (import/export), not CommonJS (require)
- **`scripts`** -- commands you run with `npm run <name>`
- **`devDependencies`** -- tsx for running TS, @types/node for type hints, typescript for type checking

### tsconfig.json

TypeScript configuration. Key settings:
- `"strict": true` -- catches common bugs at compile time
- `"target": "ES2022"` -- modern JavaScript output (top-level await, etc.)
- `"module": "Node16"` -- Node.js module resolution (respects `"type": "module"` in package.json)

### Comparison with Elixir and Bun

| Elixir/Mix | Bun | Node.js |
|---|---|---|
| `mix new ignite --sup` | `bun init` | `npm init -y` |
| `mix.exs` | `package.json` | `package.json` |
| `mix compile` | Not needed | Not needed (tsx transpiles on-the-fly) |
| `iex -S mix` | `bun src/app.ts` | `npx tsx src/app.ts` |
| `mix test` | `bun test` | `node --test` |
| `mix deps.get` | `bun install` | `npm install` |

## Step-by-Step Setup

### 1. Create the project

```bash
mkdir blaze && cd blaze
npm init -y
```

### 2. Set up package.json

Replace the generated `package.json` with:

```json
{
  "name": "blaze",
  "version": "0.0.0",
  "description": "Phoenix + LiveView clone for Node.js, built from scratch",
  "type": "module",
  "main": "src/app.ts",
  "scripts": {
    "dev": "npx tsx --watch src/app.ts",
    "start": "npx tsx src/app.ts",
    "test": "node --test tests/**/*.test.ts"
  },
  "license": "MIT",
  "devDependencies": {
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

### 3. Install dependencies

```bash
npm install
```

This installs three dev dependencies:
- **tsx** -- TypeScript executor (runs .ts files directly)
- **@types/node** -- Type definitions for all `node:*` APIs
- **typescript** -- TypeScript compiler (for type checking, not execution)

### 4. Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 5. Create the directory structure

```bash
mkdir -p src/blaze public templates tutorial tests
```

### 6. Create the entry point

Create `src/app.ts`:

```typescript
console.log("Blaze is ready!");
```

### 7. Verify it works

```bash
npx tsx src/app.ts
```

You should see: `Blaze is ready!`

### 8. Verify watch mode

```bash
npm run dev
```

This starts tsx in watch mode. Edit `src/app.ts` and save -- it
auto-restarts. Press `Ctrl+C` to stop.

### 9. Verify type checking

```bash
npx tsc --noEmit
```

This runs the TypeScript compiler in check-only mode (no output files).
Should complete with zero errors.

### 10. Initialize git and commit

```bash
git init
git add .
git commit -m "Step 0: Project setup"
git tag step-00
```

## Try It Out

Run these commands to verify everything is set up correctly:

```bash
# 1. Check Node.js version (should be 22+)
node --version

# 2. Check npm version
npm --version

# 3. Run the entry point
npx tsx src/app.ts
# → Blaze is ready!

# 4. Type check passes
npx tsc --noEmit
# → (no output = success)

# 5. Watch mode works
npm run dev
# → Blaze is ready!
# (Ctrl+C to stop)
```

## File Checklist

After this step, your project should have these files:

| File | Status | Purpose |
|------|--------|---------|
| `package.json` | Created | Project configuration + scripts |
| `package-lock.json` | Generated | Dependency lock file |
| `tsconfig.json` | Created | TypeScript configuration |
| `.gitignore` | Created | Git ignore patterns |
| `README.md` | Created | Project documentation |
| `src/app.ts` | Created | Entry point (just a console.log for now) |
| `src/blaze/` | Created | Framework core directory (empty) |
| `src/app.ts` | Created | Application entry point |
| `public/` | Created | Client-side assets directory (empty) |
| `templates/` | Created | HTML templates directory (empty) |
| `tutorial/` | Created | Tutorial docs directory |
| `tests/` | Created | Test files directory (empty) |

---

[Next: Step 1 - HTTP Server →](01-http-server.md)

## What's Next

We have a working TypeScript project. In **Step 1**, we'll build the first
real piece: an **HTTP server** using `node:http` that listens on port
4001 and responds "Hello, Blaze!" to every browser request.
