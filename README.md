# Blaze -- Build Your Own Web Framework with Node.js

**A hands-on training guide** that teaches TypeScript and Node.js by building **Blaze**, a production-grade web framework inspired by [Elixir Phoenix](https://www.phoenixframework.org/) and [LiveView](https://hexdocs.pm/phoenix_live_view). Go from a bare `http.createServer()` to a full-stack framework with LiveView, WebSockets, PubSub, Presence, and DOM diffing -- all in incremental, well-documented steps.

---

## Training Overview

| | |
|---|---|
| **Steps** | 59 commits, each with a detailed tutorial |
| **Prerequisites** | Basic programming experience (any language) |
| **Format** | Read tutorial -> write code -> verify -> move on |
| **Dependencies** | Zero external deps for the first 14 steps |
| **Runtime** | Node.js v22+ LTS |

### How to Use This Guide

Each step is a git tag. You can follow along commit-by-commit, or jump to any step:

```bash
git checkout step-00   # Start from Step 0
git checkout step-14   # Jump to uWebSockets.js migration
git checkout main      # See the complete framework
```

Every step has a matching tutorial doc in `tutorial/` with:
- What we built and why
- Full code with explanations
- Key concepts introduced
- Verification commands to confirm it works

## Quick Start

```bash
# Clone the repo
git clone https://github.com/rajeshpillai/node-byowf.git
cd node-byowf

# Install dependencies
npm install

# Start the dev server (with watch mode)
npx tsx --watch src/app.ts

# Visit http://localhost:4001
```

## Project Structure

```
node-byowf/
├── src/
│   ├── blaze/           # Framework core
│   │   └── server.ts    # node:http → uWebSockets.js
│   ├── ember/           # Ember ORM (Ecto for Node.js)
│   └── app.ts           # Application entry point (routes, config)
├── tests/
│   ├── step-*.test.ts   # Framework unit tests (by step)
│   └── ember/           # ORM unit tests
├── public/              # Client-side assets
├── templates/           # HTML templates
├── tutorial/            # Step-by-step tutorial docs
├── package.json
├── tsconfig.json
└── README.md
```

## Running Tests

```bash
# Run all tests
npx tsx --test tests/**/*.test.ts

# Run framework (Blaze) tests only
npx tsx --test tests/step-*.test.ts

# Run ORM (Ember) tests only
npx tsx --test tests/ember/*.test.ts

# Run a specific test file
npx tsx --test tests/step-03-router.test.ts
```

## Build Plan

| Module | Steps | Description |
|--------|-------|-------------|
| HTTP Foundations | 00–13 | Vanilla `node:http`, routing, templates, middleware |
| LiveView Core | 14–20 | uWebSockets.js migration, LiveView, diffing, morphdom |
| Broadcasting | 21–24 | PubSub, navigation, components, JS hooks |
| LiveView Advanced | 25–28 | Streams, temp assigns, file uploads |
| Data & State | 29–31 | Sessions, presence, SQLite |
| Security | 32–33 | CSRF, CSP |
| Developer Experience | 34–38 | CLI, error pages, logger, assets, tests |
| Production | 39–43 | Health, SSL, rate limiting, cluster, SEA |
| Ember ORM | 44–51 | Schema, changeset, repo, query, migrations, associations |
| Ember Extras | 52–57 | Multi, aggregates, pagination, seeds, soft deletes |
| Capstone | 58 | Todo app (all features) |

See [todo.md](todo.md) for the full build plan with details on each step.

## Reference

This project mirrors the structure of:
- [elixir-byof](https://github.com/rajeshpillai/elixir-byowf) -- Ignite framework (Elixir/Phoenix)
- [bun-byowf](https://github.com/rajeshpillai/bun-byowf) -- Blaze framework (Bun)

Same architecture, adapted for vanilla Node.js idioms.

## License

MIT
