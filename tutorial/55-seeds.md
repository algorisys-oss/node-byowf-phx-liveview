[← Step 54: Pagination](54-pagination.md) | [Step 56: Soft Deletes →](56-soft-deletes.md)

# Step 55 — Seeds

## What We're Building

A database seeding system for populating initial or test data. Register seed functions by name, then run them all inside a transaction. If any seed fails, everything rolls back.

## Concepts You'll Learn

- **Seed registry** — register named seed functions that receive a `Repo`
- **Transactional seeding** — all seeds run in one transaction for atomicity
- **Script pattern** — `npm run seed` entry point

## How It Works

```
seed("admins", fn)     → pushes { name: "admins", fn } to registry
seed("test-data", fn)  → pushes { name: "test-data", fn } to registry
runSeeds(repo)         → BEGIN TRANSACTION
                          → fn("admins", repo)
                          → fn("test-data", repo)
                        → COMMIT
                        → { seeded: ["admins", "test-data"] }
```

If any seed throws, the transaction rolls back and no data is persisted.

## The Code

### `src/ember/seeds.ts`

```typescript
/**
 * Ember Seeds — database seeding infrastructure.
 *
 * Provides a structured way to populate databases with initial or test data.
 *
 * Usage:
 *   // priv/seeds.ts
 *   import { seed, runSeeds } from "./ember/seeds.js";
 *
 *   seed("users", (repo) => {
 *     repo.insertAll(UserSchema, [
 *       { username: "admin", email: "admin@app.com" },
 *       { username: "test", email: "test@app.com" },
 *     ]);
 *   });
 *
 *   runSeeds(repo);
 */

import type { Repo } from "./repo.js";

interface SeedEntry {
  name: string;
  fn: (repo: Repo) => void;
}

const seeds: SeedEntry[] = [];

/** Register a seed function. */
export function seed(name: string, fn: (repo: Repo) => void): void {
  seeds.push({ name, fn });
}

/** Run all registered seeds inside a transaction. */
export function runSeeds(repo: Repo, options: { log?: boolean } = {}): { seeded: string[] } {
  const log = options.log ?? true;
  const seeded: string[] = [];

  repo.transaction(() => {
    for (const entry of seeds) {
      if (log) console.log(`  Seeding: ${entry.name}`);
      entry.fn(repo);
      seeded.push(entry.name);
      if (log) console.log(`  ✓ ${entry.name} done`);
    }
  });

  return { seeded };
}

/** Clear all registered seeds (useful for testing). */
export function clearSeeds(): void {
  seeds.length = 0;
}

/** Get registered seed count. */
export function seedCount(): number {
  return seeds.length;
}
```

### Key Design Decisions

**Module-level registry:** The `seeds` array is a module-level singleton. Calling `seed("name", fn)` at import time registers the seed function. This works because Node.js modules are cached after first import — every file that imports `seeds.ts` shares the same array.

**Transaction wrapping:** `runSeeds()` wraps all seed functions in a single `repo.transaction()` call. If any seed throws an error, the entire transaction rolls back, leaving the database unchanged. This prevents partial seeding.

**Logging control:** The `log` option defaults to `true` for interactive use but can be disabled in tests with `runSeeds(repo, { log: false })`.

**`clearSeeds()` for testing:** Since the registry is a module-level singleton, tests need a way to reset it between runs. `clearSeeds()` empties the array without replacing it.

### Usage Example

```typescript
// priv/seeds.ts
import { seed, runSeeds } from "../src/ember/seeds.js";

seed("admins", (repo) => {
  repo.insertAll(UserSchema, [
    { username: "admin", email: "admin@app.com" },
  ]);
});

seed("test-data", (repo) => {
  repo.insertAll(UserSchema, [
    { username: "alice", email: "alice@test.com" },
    { username: "bob", email: "bob@test.com" },
  ]);
});

// In your setup script:
runSeeds(repo);
// Output:
//   Seeding: admins
//   ✓ admins done
//   Seeding: test-data
//   ✓ test-data done
```

## Try It Out

```bash
npm test
```

5 seed tests pass covering registration, ordering, transactional rollback, and edge cases.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/seeds.ts` | **New** | Seed registry and runner |
| `test/seeds.test.ts` | **New** | 5 tests for seeding |

## What's Next

**Step 56 — Soft Deletes:** `deleted_at` timestamp, auto-filtered queries, `withTrashed()`.

[← Step 54: Pagination](54-pagination.md) | [Step 56: Soft Deletes →](56-soft-deletes.md)
